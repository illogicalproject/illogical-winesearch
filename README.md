# Illogical Wine Search 🍷

AI-powered wine inventory manager. Photograph your bottles and Claude Vision
automatically identifies the producer, vintage, varietal, region, and more.
Your cellar lives in a local JSON file — no database setup required.

---

## Prerequisites

Install these once. Skip anything you already have.

### 1. Node.js (version 18 or higher)
- Download from: https://nodejs.org (choose the LTS version)
- Verify install: open PowerShell and run:

node --version

You should see v18.x.x or higher.

### 2. An Anthropic API Key
- Sign up at: https://console.anthropic.com
- Go to **API Keys** and create a new key
- Keep it somewhere safe — you'll need it below

---

## First-Time Setup

Do this once after cloning the repo.

### Step 1 — Navigate to the project folder
```powershell
cd "C:\Users\Brian\OneDrive\Documents2\GitHub\illogical-winesearch"

Step 2 — Install dependencies
npm install

This installs Express, Multer, the Anthropic SDK, and other packages into a
node_modules folder. Takes about 30 seconds.

Step 3 — Create your .env file
notepad .env

Click Yes to create it. Type exactly this (replace with your real key):

ANTHROPIC_API_KEY=sk-ant-api03-your-key-here

Save and close. This file is gitignored and will never be committed.

Running the App
Every time you want to use the wine app, do this:

Step 1 — Open PowerShell and navigate to the folder
cd "C:\Users\Brian\OneDrive\Documents2\GitHub\illogical-winesearch"

Step 2 — Start the server
npm start

You should see:

🍷 Wine Inventory Bot running → http://localhost:3000

Step 3 — Open the app in your browser
Go to: http://localhost:3000

Step 4 — Stop the server when done
Press Ctrl + C in PowerShell.

Development Mode (auto-restarts on code changes)
If you are editing code and want the server to restart automatically:

npm run dev

How to Use the App
Scanning a Bottle
Click Scan or the upload zone
Upload a photo of one or more wine bottles (JPEG, PNG, WEBP — max 20MB)
Claude Vision reads the labels and fills in all the details automatically
Review the results and click Add to Cellar to save
iPhone Photos (HEIC format)
iPhones save photos as HEIC by default which cannot be analyzed directly.
Two options:

In the Photos app, tap Share → Save as JPEG before uploading
Use the in-app Camera tab to capture a frame directly
Managing Your Cellar
View all bottles on the main cellar screen
Tap any bottle to see full details, tasting notes, and drinking window
Edit quantity, add personal notes, or delete entries
If a duplicate is detected, you'll be prompted to increase the quantity
Exporting Your Inventory
Go to: http://localhost:3000/api/export/csv
This downloads your full cellar as a CSV file you can open in Excel.

File Structure
illogical-winesearch/
├── server.js            ← Node.js backend server
├── package.json         ← Dependencies and scripts
├── .env                 ← Your API key (never committed)
├── .gitignore           ← Keeps .env and uploads out of git
├── wine_inventory.json  ← Your cellar data (auto-created on first save)
├── uploads/             ← Bottle photos (auto-created)
└── public/
    ├── index.html       ← Frontend UI
    └── app.js           ← Frontend JavaScript

Troubleshooting
"Cannot find module" error when starting
You need to install dependencies:

npm install

"ANTHROPIC_API_KEY is not set" warning
Your .env file is missing or has the wrong key. Check:

cat .env

It should show: ANTHROPIC_API_KEY=sk-ant-...

Port 3000 already in use
Something else is running on port 3000. Either stop that process, or run
on a different port:

$env:PORT=3001; npm start

Then open http://localhost:3001

App opens but scanning does nothing
Check that your API key in .env is valid and not expired
Go to https://console.anthropic.com to verify the key is active
Check the PowerShell window for error messages after scanning
Lost your wine inventory data
Your data is in wine_inventory.json in the project folder. Do not delete
this file. Back it up by copying it somewhere safe periodically, or export
to CSV using the link above.

Updating the App
When there are new changes on GitHub:

cd "C:\Users\Brian\OneDrive\Documents2\GitHub\illogical-winesearch"
git pull origin main
npm install
npm start

Quick Reference Card
Task	Command
Start app	npm start
Start (dev mode)	npm run dev
Install/update packages	npm install
Export cellar to CSV	Visit http://localhost:3000/api/export/csv
Stop the server	Ctrl + C

---

Once saved, commit and push it:

```powershell
cd "C:\Users\Brian\OneDrive\Documents2\GitHub\illogical-winesearch"
git add README.md
git commit -m "Add detailed setup and usage README"
git push origin main

