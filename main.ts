import { MongoClient, ObjectId, ServerApiVersion } from 'mongodb';
import { addIcon, App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TAbstractFile } from 'obsidian';
import Papr, { Model, schema, SchemaOptions, types } from 'papr';
import sync_icon from 'sync_icon';
import LZUTF8 from "lzutf8"

// ! Small Disclaimer
// The reason all of the models and other things that would usually be separated into separate chunks are all in `onload`
// is because there was some odd build/loading issues when trying to start them in Obsidian

interface MongoSyncSettings {
	mongoDbUri: string,
}

const DEFAULT_SETTINGS: MongoSyncSettings = {
	mongoDbUri: "",
}

export default class MongoSyncPlugin extends Plugin {
	settings: MongoSyncSettings;
	ribbonIcon: HTMLElement;
	validUri:boolean;
	initialLoadComplete:boolean;
	syncInProgress:boolean;
	dbClient:MongoClient;
	paprHelper:Papr
	ObsidianDocumentModel: Model<{ path: string; compressedContent: string; lastEdited: Date; _id: ObjectId; checkSum?: number | undefined; deleted?: boolean | undefined; }, SchemaOptions<{ path: string; compressedContent: string; checkSum: number | undefined; lastEdited: Date; deleted: boolean | undefined; }>>

	async onload() {
		await this.loadSettings();

		const DEFAULT_LOAD_TIMEOUT = 3000;

		let triggerSync = async () => {

		}

		// This creates an icon in the left ribbon.
		addIcon('mongo_sync_ribbon_icon', sync_icon)
		this.ribbonIcon = this.addRibbonIcon('mongo_sync_ribbon_icon', 'Content Sync', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			if (!this.validUri){
				new Notice('Failed to connect to MongoDB, please check your Connection URI in the plugin settings and the Network/Database Access page of your MongoDB Database.');
			} else {
				if (!this.dbClient){
					new Notice('Connecting to MongoDB...')
				}else{
					if (this.syncInProgress){
						new Notice('Sync in progress...')
					}else{
						triggerSync();
						new Notice('Sync Started!')
					}
				}
			}
		});

		const setSyncInProgress = (inProgress:boolean) => {
			if (inProgress){
				this.ribbonIcon.style.setProperty('cursor', 'not-allowed')
				this.ribbonIcon.style.setProperty('opacity', '70%')
			}else {
				this.ribbonIcon.style.setProperty('cursor', 'pointer')
				this.ribbonIcon.style.setProperty('opacity', '100%')
			}
		}

		const setValidUri = (valid:boolean) => {
			this.validUri = valid;

			if (!valid){
				this.ribbonIcon.style.setProperty('color', '#E63462')
			}
		}
		
		if (!(/(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/[a-zA-Z0-9]+\.[^\s]{2,}|[a-zA-Z0-9]+\.[^\s]{2,})/ig.test(this.settings.mongoDbUri))) {
			setValidUri(false);
			//return;
		}else{
			setValidUri(true);

			const mongoConnectionStatusEl = this.addStatusBarItem();
			mongoConnectionStatusEl.setText('Connecting to MongoDB...');

			try {
				const client = await MongoClient.connect(this.settings.mongoDbUri);

				const papr = new Papr();

				papr.initialize(client.db('obsidian-sync'));

				this.dbClient = client;
				this.paprHelper = papr;

				const obsidianDocumentSchema = schema({
					path: types.string({ required: true }),
					compressedContent: types.string({ required: true }),
					checkSum: types.number({required: false}),
					lastEdited: types.date({ required: true }),
					deleted: types.boolean({required: false})
				});


				const ObsDocModel = this.paprHelper.model('obsidian-documents', obsidianDocumentSchema);

				this.ObsidianDocumentModel = ObsDocModel;
				
				mongoConnectionStatusEl.setText('MongoDB Connected!');
			} catch (error) {
				setValidUri(false);
				mongoConnectionStatusEl.setText('Connecting to MongoDB...');
				new Notice('Couldn\'t connect to MongoDB using your URI, please double check it in the Mongo Sync plugin settings and on your MongoDB dashboard.');

				mongoConnectionStatusEl.setText('MongoDB Failed to Connect :(');
			}

			setTimeout(() => {
				mongoConnectionStatusEl.remove();
			}, 4000);
		}

		const stringChecksum = (str:string):number => {
			let checksum = 0;

			for (let i = 0; i < str.length; i++) {
				checksum += str.charCodeAt(i);
			}

			return checksum % 256;
		}

		triggerSync = async () => {
			if (this.validUri){
				setSyncInProgress(true);

				let mongoSyncingStatusEl;

				if (!this.initialLoadComplete){
					mongoSyncingStatusEl = this.addStatusBarItem();
					mongoSyncingStatusEl.setText('Syncing to MongoDB...');
				}
				

				const markdownFiles = this.initialLoadComplete ? this.app.vault.getMarkdownFiles() : this.app.vault.getFiles();

				if (mongoSyncingStatusEl) mongoSyncingStatusEl.setText('Syncing to MongoDB (' + markdownFiles.length + ' items)...');			

				let loadingIcons = ["—", "\\", "|", "/"]

				let i = 0;

				let docs = await this.ObsidianDocumentModel.find({deleted: false});

				for (const doc of docs){
					if (!this.app.vault.getFileByPath(doc.path)){
						this.app.vault.create(doc.path, LZUTF8.decompress(doc.compressedContent, { inputEncoding:'Base64', outputEncoding:'String' }), {mtime: new Date(doc.lastEdited).getTime()})
					}
				}

				for (const file of markdownFiles) {
					// Read the content of each Markdown file

					let existingDoc = await this.ObsidianDocumentModel.findOne({path: file.path});

					if (mongoSyncingStatusEl) mongoSyncingStatusEl.setText(loadingIcons[i % loadingIcons.length] + ' Syncing ' + file.name);

					const content = await this.app.vault.read(file);

					if (!existingDoc){
						existingDoc = await this.ObsidianDocumentModel.insertOne({
							compressedContent: LZUTF8.compress(content, {
								outputEncoding: 'Base64',
								inputEncoding: 'String'
							}),
							lastEdited: new Date(),
							path: file.path,
							checkSum: stringChecksum(content)
						})
					}else{
						const cloudLastEditTime = new Date(existingDoc.lastEdited).getTime();
						const localLastEditTime = new Date(file.stat.mtime).getTime();

						if (existingDoc.deleted) {
							new Notice("Propagated deletion of " + file.path + " to local client.")

							this.app.vault.delete(file);
						}else if (existingDoc.checkSum !== stringChecksum(content)){
							if (cloudLastEditTime !== localLastEditTime){
								if (cloudLastEditTime > localLastEditTime){
									this.app.vault.modify(file, LZUTF8.decompress(existingDoc.compressedContent, { inputEncoding:'Base64', outputEncoding:'String' }), {mtime: cloudLastEditTime})
								}else{
									await this.ObsidianDocumentModel.updateOne({_id: existingDoc._id}, {
										$set: {
											compressedContent: LZUTF8.compress(content, {
												outputEncoding: 'Base64',
												inputEncoding: 'String'
											}),
											lastEdited: new Date(file.stat.mtime),
											checksum: stringChecksum(content)
										}
									})
								}
							} 
							
						}

						
					}

					if (!existingDoc){
						if (mongoSyncingStatusEl) mongoSyncingStatusEl.setText('Failed to Sync (' + markdownFiles.length + ' items)...');		
						continue;
					}
				

					i += 1;
					
					// Perform operations on the file content or metadata
					// Example: count words, search for specific patterns, modify content, etc.
				}

				if (!this.initialLoadComplete) this.initialLoadComplete = true;
				setSyncInProgress(false);
				if (mongoSyncingStatusEl) mongoSyncingStatusEl.remove();
			}
		}

		setTimeout(async () => {
			triggerSync();
		}, DEFAULT_LOAD_TIMEOUT);

		this.registerEvent(this.app.vault.on('rename', async (file, oldPath) => {
			
			try {
				if (this.validUri){
					let existingDoc = await this.ObsidianDocumentModel.findOne({path: oldPath});

					if (existingDoc){
						await this.ObsidianDocumentModel.updateOne({_id: existingDoc._id}, {
							$set: {
								path: file.path
							}
						})
					}
				}
			} catch (error) {
				
			}

		}))

		this.registerEvent(
			this.app.vault.on('delete', async (file: TAbstractFile) => {
				// Your logic to handle the deleted file goes here.
				// For example, you can log the path of the deleted item.
				if (this.validUri){
					try {
						let existingDoc = await this.ObsidianDocumentModel.findOne({path: file.path});

						if (existingDoc){
							await this.ObsidianDocumentModel.updateOne({_id: existingDoc._id}, {
								$set: {
									deleted: true
								}
							})
						}

						new Notice("Delete successfully propagated to MongoDB.")
					} catch (error) {
						
					}
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('create', async (file: TAbstractFile) => {
				// Your logic to handle the deleted file goes here.
				// For example, you can log the path of the deleted item.
				if (this.validUri && this.initialLoadComplete){
					try {
						let existingDoc = await this.ObsidianDocumentModel.findOne({path: file.path});

						if (existingDoc && existingDoc.deleted){
							await this.ObsidianDocumentModel.updateOne({_id: existingDoc._id}, {
								$set: {
									deleted: false,
									checkSum: stringChecksum(""),
									compressedContent: LZUTF8.compress("", {
										outputEncoding: 'Base64',
										inputEncoding: 'String'
									}),
									lastEdited: new Date()
								}
							})
						}

						new Notice("Create successfully propagated to MongoDB.")
					} catch (error) {
						
					}
				}
			})
		);

		// Perform additional things with the ribbon
		// this.ribbonIcon.addClass('my-plugin-ribbon-class');

		// This adds a simple command that can be triggered anywhere
		/*
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});
		*/

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new MongoSyncUriSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(async () => {
			triggerSync();
		}, 30 * 1000));
	}

	onunload() {
		this.dbClient.close();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class MongoSyncUriSettingTab extends PluginSettingTab {
	plugin: MongoSyncPlugin;

	constructor(app: App, plugin: MongoSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('MongoDB Connection URI')
			.setDesc('Enter your Mongo Connection URI, not sure how to get this?\n\nCheck https://www.mongodb.com/docs/manual/reference/connection-string\n\nIt is recommended you create a new cluster for security reasons, but if you decide to use an existing cluster then be aware the plugin will write to the \'obsidian-documents\' db.')
			.addText(text => text
				.setPlaceholder('Enter your URI, remember to keep your connection username and password.')
				.setValue(this.plugin.settings.mongoDbUri)
				.onChange(async (value) => {
					this.plugin.settings.mongoDbUri = value;
					await this.plugin.saveSettings();
				}));
	}
}
