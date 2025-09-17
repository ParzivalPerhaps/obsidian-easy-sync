# Obsidian Mongo Sync

Sync your Obsidian vault across devices **for free** using a MongoDB database as the backend.

This plugin allows you to keep your notes, files, and folders in sync without relying on paid sync services. Just provide a MongoDB connection URI, and the plugin handles syncing automatically in the background.

---

## Features

* **Automatic Sync** – changes are detected and synced across all devices.
* **Simple Setup** – paste your MongoDB connection URI in the settings and go.
* **Full Vault Sync** – works across your notes, attachments, and folder structure.
* **Cross-Device** – connect multiple devices to the same database for instant sync.
* **Private** – you control the database; your notes aren’t sent to third-party services.

---

## Getting Started

### 1. Install the Plugin

1. Download and install this plugin into your Obsidian vault’s `.obsidian/plugins` folder.
2. Enable it from **Settings → Community Plugins**.

### 2. Set Up MongoDB

You’ll need access to a MongoDB database. Options:

* [MongoDB Atlas (Free Tier)](https://www.mongodb.com/atlas/database) – hosted, free cloud database.
* Local MongoDB instance.

### 3. Configure the Plugin

1. Go to **Settings → Obsidian Mongo Sync**.
2. Paste your MongoDB connection URI (e.g. `mongodb+srv://user:password@cluster0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`).
3. Choose a database/collection name (default: `obsidian-documents`).

That’s it! The plugin will begin syncing automatically.

---

## Notes & Limitations

* If you expect large files (images, PDFs, etc.), ensure your MongoDB cluster has enough storage.
* Initial sync may take a few minutes depending on vault size.
* Conflicts are resolved using **last write wins** (the most recent edit overwrites older versions).