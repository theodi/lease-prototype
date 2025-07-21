# ⚠️ Work in Progress

> **Warning:** This READNE is a work in progress. Most of it is AI generated and has yet to be fully checked for error. 

# 🏠 Lease Lnegth Finder Tool


A web application for exploring UK government lease data.
Built with Node.js, Express, MongoDB, and OpenAI for intelligent data interactions.

---

## 🚀 Features

* 🔐 **Email-based login with domain restrictions**
* 📄 **Search and view property lease records**
* 📌 **Bookmark leases for later review**
* 🧠 **AI-powered assistance (OpenAI integration)**
  * **AI-powered lease length calculation from free text terms**
* 📈 **Usage tracking and rate limits**
* 📥 **Automatic data updates from GOV.UK APIs**
* 🛠️ **Admin dashboard with version tracking and bug reports**
* 🧾 **Self-service Subject Access Requests (SAR)**

---

## 🔑 Accessing the Tool

### Login & Verification

* Users must **sign in with a valid email**.
* A **verification code** is sent via email to confirm identity.
* Behaviour varies by environment:

  * **Development**: No emails sent, any email accepted, code = `DEV_VERIFICATION_CODE`.
  * **Testing**: Emails sent, only domains listed in `ALLOWED_DOMAINS` permitted.
  * **Production**: Emails sent, **any domain** permitted, but only `ALLOWED_DOMAINS` users can see admin features.

---

## 📁 Environment Setup

### 1. Clone the repo

```bash
git clone https://github.com/theodi/lease-prototype.git
cd lease-prototype
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Then update the values based on your deployment environment. Refer to comments in `.env.example` for detailed documentation.

---

## 🧰 Running the App

### Development

```bash
node app.js
```

Serve with a process manager like PM2 or behind a reverse proxy.

---

## 🗃️ Database & Models

The tool uses **MongoDB** and includes the following collections:

| Collection         | Description                                                        |
|--------------------|--------------------------------------------------------------------|
| `Lease`            | Stores lease records, imported from GOV.UK CSV data                |
| `LeaseTermCache`   | Caches parsed lease term strings, start/end dates, and model used  |
| `LeaseTracker`     | Tracks changes to leases across updates                            |
| `LeaseUpdateLog`   | Stores update version info and summaries (add/delete/etc)          |
| `LeaseViewStat`    | Tracks statistics on lease views                                   |
| `BugReport`        | Stores submitted bug reports via the UI                            |
| `User`             | User accounts, verification codes, and bookmarks                   |
| `UserLoginStat`    | Daily, monthly, yearly login stats for usage tracking              |
| `SearchAnalytics`  | Stores analytics on which search indexes are used                  |

---

## 🏗️ Initial Data Import

The first time you set up the tool, you need to prepare and import the lease data manually. We recommend using **MongoDB Compass** for this process.

### 1. Obtain the Full Dataset
- Download the full lease dataset (not the update files ) from [`https://use-land-property-data.service.gov.uk/datasets/leases`](https://use-land-property-data.service.gov.uk/datasets/leases)

### 2. Prepare the CSV Files
- Place the downloaded CSV in the `data/` directory.
- Run the following script to split the large CSV into chunks of 1,000,000 records and add postcode information to each record:

```bash
node data/prepare-csv.js
```

This will generate a set of processed CSV files in the `data/` directory, ready for import.

### 3. Start the Application (to create collections)
- Run the application once to allow it to connect to your MongoDB instance and create the necessary collections:

```bash
node app.js
```

### 4. Import Data Using MongoDB Compass
- Open **MongoDB Compass** and connect to your database.
- Select the database and the `leases` collection (created by the app).
- Use the **"Import Data"** feature to load the processed CSV files into the `leases` collection.

### 5. Set Up Search Indexes in MongoDB Atlas

The application requires two search indexes for optimal performance:
- `default`
- `addr_autocomplete`

These must be set up manually in **MongoDB Atlas**:

1. Log in to your MongoDB Atlas account and navigate to your cluster.
2. Go to the **"Search"** tab for your database.
3. Click **"Create Search Index"**.
4. For each index:
   - Select the `leases` collection.
   - Choose **"JSON Editor"** mode.
   - Copy the JSON definition from the corresponding file in `data/atlas-search-indexes/` (`default.json` or `addr_autocomplete.json`).
   - Paste it into the editor and create the index.

Repeat for both `default` and `addr_autocomplete` indexes.

---

## 📦 Data Updates

### 🔄 Fetching Data Updates with `check-for-updates.js`

The `check-for-updates.js` script is used to fetch the latest "Change Only" update files from the government dataset. This script can be run independently of the main application, and can even be set up on a different server or location if desired.

### How it works
- Connects to the GOV.UK API and checks for new update files.
- Downloads and extracts the latest change file if a new version is available.
- Cleans up the CSV and prepares it for import.
- Logs the update in the database to avoid duplicate processing.

### Usage

```bash
node check-for-updates.js
```

Make sure your environment variables (API key, MongoDB URI, etc.) are set up as required.

### Automation

To keep your data up to date, we recommend setting up a cron job or scheduled task to run this script regularly (e.g. daily):

Example crontab entry (run every day at 2am):

```
0 2 * * * cd /path/to/your/project && /usr/bin/node check-for-updates.js >> update.log 2>&1
```

This ensures your system automatically fetches and processes new updates as they become available.

### Applying data updates

Once you have downloaded and prepared the latest update file (CSV) using `check-for-updates.js`, you need to apply the changes to your database. This process is currently **human-driven** to ensure data integrity—it's important to manually check that the update file is correct before making any changes.

#### Usage

You can run the update script in two modes:

- **Dry-run mode (recommended first):**
  This will simulate the update and show you what would be changed, without modifying the database.
  ```bash
  node apply-update.js path/to/changes.csv
  ```

- **Apply mode:**
  This will actually apply the changes to your database.
  ```bash
  node apply-update.js path/to/changes.csv --apply
  ```

The script will prompt you for confirmation in ambiguous cases and provide a summary of additions, deletions, and manual actions required. Always review the dry-run output before proceeding with the actual update.

---

## 🧠 AI Assistance (OpenAI)

The app uses OpenAI to provide:

* Automatic calculation of lease lengths from free text lease term fields

## Lease Length Calculation

In the source data, the lease term is provided as a free text field, which can vary greatly in format and complexity. Examples include:

- `7 days before the end of 1932 for 100 years`
- `From 25 December 1999 for 99 years`
- `21 years from 29 September 1980`
- `Term: 125 years from 1 January 2000`
- `99 years from 24 June 1985`
- `From 1/1/1980 to 31/12/2079`
- `From 3rd December 1950 to the last day of 2023 inclusive.`
- `From 00:01 on 1 January 2020 to 23:59 on 31 December 2020.`

These descriptions can be ambiguous or require contextual understanding to interpret correctly. The system first attempts to match the lease term string against three common regular expressions that cover the majority of standard cases. If a match is found, the start and end dates are extracted directly.

For more complex or ambiguous cases that do not match these patterns, the AI model is used to extrapolate the lease start and end dates, returning them as ISO standard date objects. These dates are then used to calculate the lease length in years, enabling consistent searching, filtering, and analysis.

To optimize performance and avoid redundant AI calls, the results of AI-based parsing are cached in the `LeaseTermCache` collection (see `models/LeaseTermCache.js`). This ensures that once a lease term string has been processed, its parsed results are reused for future queries.

The model used for each extraction is also logged in the cache. This allows you to evaluate which model derived which results, making it possible to compare and benchmark different models. However, there is no built-in feature to invalidate or remove old cache entries if you change the model. If you wish to clear out cached results from previous models, you will need to do so manually.

* Set your `OPENAI_API_KEY` in `.env` to enable this feature.

---

## 📊 Admin Dashboard

Available to users from domains listed in `ALLOWED_DOMAINS`.

Includes:

* Lease and user count
* Search type statistics
* Top viewed leases (all time & past month)
* Dataset update logs
* Bug report viewer
* Login activity charts (daily/monthly/yearly)

---

## 👤 User Features

* **Bookmarking**: Save interesting leases for later
* **Recently Viewed**: Auto-tracked per session
* **Subject Access Requests (SAR)**: Export your data via the "My Account" page
* **Bug Reporting**: Submit issues from the app interface

---

## 🧪 Testing & Test Mode

* Set `NODE_ENV=testing` or `TESTING=1`
* Emails will be sent, but **only users from `ALLOWED_DOMAINS`** can log in

---

## 📂 Folder Structure

```
.
├── app/                 # Routes, views, and core logic
├── models/              # Mongoose models
├── public/              # Static assets
├── scripts/             # Data update scripts
├── views/               # EJS templates
├── .env.example         # Environment config
└── server.js            # Main application entry point
```

---

## ✅ Deployment Tips

* Use a reverse proxy (e.g. Nginx) for HTTPS and domain routing
* Use a process manager like PM2 to ensure uptime
* Set up a cron job to check for updates (e.g. run `update-dataset.js` daily)
* Configure MongoDB backups and monitoring

