# 🏠 Lease Length Finder Tool

A web application for exploring UK government lease data.
Built with Node.js, Express, MongoDB, and OpenAI for intelligent data interactions.

---

## 🚀 Features

* 🔐 **Email-based password-less login**
* 📄 **Search and view property lease records**
* 📌 **Bookmark leases for later review**
* 🧠 **AI-powered lease length calculation from free text terms**
* 📈 **Usage tracking and rate limits**
* 📥 **Semi-Automatic data updates from GOV.UK APIs**
* 🛠️ **Admin dashboard with version tracking and bug reports**
* 🧾 **Self-service Subject Access Requests (SAR)**

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

Then update the values based on your deployment environment. Refer to comments in `.env.example` for detailed documentation on the tools configuration and features not detailed here.

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
- Download the full lease dataset (not the update files) from [`https://use-land-property-data.service.gov.uk/datasets/leases`](https://use-land-property-data.service.gov.uk/datasets/leases)

### 2. Prepare the CSV Files
- Place the downloaded CSV in the `data/` directory.
- Run the following script to split the large CSV into chunks of 1,000,000 records and add postcode information to each record:

```bash
node data/prepare-csv.js
```

This will generate a set of processed CSV files in the `data/` directory, ready for import (1 million rows per file).

During the process, the tenure key is removed (redundant) and postcode extraacted from the regisitered or associated property descriptions (whichever matches first). 

All keys are shortened to abbreviations of 4 charecters or fewer (this saves a lot of storage space in the database!). The data model handles the re-mapping for the ejs rendering.

**Note:** No derived information (such as lease length or parsed dates) is generated or stored at the time of import. This is intentional for two reasons:
- Calculating derived values (like lease length) for every record at import would be time-consuming and resource-intensive.
- Most importantly, keeping the database as close to the raw, authoritative Land Registry data as possible ensures that users always see the official record. No data cleaning or transformation is performed during import, except for extracting the postcode for search purposes. This avoids the risk of presenting users with data that differs from the official source, which could be critical for users who are investigating issues with their lease.

Any derived or calculated information (such as lease length) is shown separately in the user interface, clearly distinguished from the source data. This helps ensure users do not confuse derived values with the original data provided by the Land Registry.

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

## 🔍 Search Functionality

The tool provides a powerful search experience by combining several techniques, including postcode matching, MongoDB Atlas Search, and client-side filtering.

### Search Logic

The search logic is tiered to provide the most relevant results efficiently:

1.  **Postcode Search**: If the query is identified as a postcode:
    *   A **full postcode** (e.g., `SW1A 2AA`) triggers a database query that returns all leases matching that exact postcode.
    *   An **outer postcode** (e.g., `SW1A`) returns a limited number of results from that area to provide a quick sample.

2.  **Text Search (Atlas Search)**: If the query is not a postcode, it's treated as a text search using MongoDB Atlas:
    *   First, the `addr_autocomplete` index is used, this enables users to search for properties by address and the search index attempts to complete the users entry, so it indexes from the start of the address, e.g. `112 Manchester Road` will return a limited number of results that have this at the start of the address. 
    *   If the results from the autocomplete index don't seem relevant (i.e., they don't contain the user's query text), the system falls back to the `default` search index which attempts to match the query to any part of the `Register Property Description` and `Associated Property Description` fields.

### Client-Side Filtering

To enhance performance, when a user searches for a full postcode, all matching lease records are fetched and cached on the client side. If the user then refines their search by adding more text (e.g., adding a street name or flat number), the cached results are filtered directly in the browser. This avoids unnecessary calls to the backend and provides an instantaneous search experience.

### Atlas Search Indexes

The application relies on two custom MongoDB Atlas Search indexes:

*   **`addr_autocomplete`**: A broad index configured for fast, "search-as-you-type" functionality across multiple fields. It's optimized for speed and is the first index to be queried.
*   **`default`**: A more targeted index focused on the primary address fields (`Register Property Description`, `Associated Property Description`). It serves as a fallback to ensure relevant results when the autocomplete index is not specific enough.

These indexes must be created manually in MongoDB Atlas as described in the **Initial Data Import** section.

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

### How the update script works

The `apply-update.js` script processes a change file in two main phases:

1. **Deletions (Removals)**
   - The script first processes all records marked for deletion.
   - For each deletion, it attempts to match the record in the database using a combination of unique identifier and key fields (such as registration order and associated property ID).
   - If there is a single, clear match, the record is deleted automatically.
   - If there are multiple possible matches, the script compares all fields and, if the difference is minimal (e.g., a single character), it will proceed with deletion.
   - For ambiguous cases where the match is not clear, the script prompts the user to decide whether to keep, delete, or skip the record. This ensures that no data is lost due to uncertain matches.

2. **Additions (Inserts)**
   - After deletions, the script processes all records marked for addition.
   - New records are inserted in bulk for efficiency.
   - The script also updates the version tracking for each unique lease that is added or deleted.

At the end of the process, a summary is displayed showing the number of additions, deletions, and manual interventions required. The script can be run in a dry-run mode (default) to preview changes, or in apply mode (`--apply`) to actually modify the database.

---

## Style, theme and cookies

The application's front-end is built using the **Bootstrap** framework, providing a responsive and consistent UI. The visual theme can be easily customized by modifying the CSS variables in `public/style.css`.

The branding is currently set to match **LEASE (The Leasehold Advisory Service)**, which was the initial client for this prototype. Key branding elements are contained within a few partial view files:

*   `views/partials/header.ejs`: Contains the main site navigation and LEASE branding. It has its own embedded styles.
*   `views/partials/footer.ejs`: Contains the site footer with links and branding. It also has its own embedded styles.

The tool implements a cookie consent banner using **Cookie Control**. The configuration can be found in `views/partials/cookie-control.ejs`. It is currently set up with **Google Analytics (GA4)** as the only optional, analytics cookie. The cookie banner is disabled in development and testing environments.

## Just in time lease term calculations using AI

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

**Warning:** The lease length and remaining term shown in the tool are derived either by regular expression matching or by AI-based parsing of the original lease term string. These methods can sometimes produce incorrect results, especially for ambiguous or complex term descriptions. Users should always check the original lease term string (which is displayed alongside any derived values) and, if in doubt, seek clarification from the official source or a qualified professional. The derived values are provided for convenience only and should not be solely relied upon for legal or financial decisions.

* Set your `OPENAI_API_KEY` in `.env` to enable this feature.

---

## 👤 User Features

* **Bookmarking**: Save leases of interest and be notified of updates
* **Recently Viewed**: Auto-tracked per session
* **Subject Access Requests (SAR)**: Export your data via the "My Account" page (accessed by clicking the user email in the top right above logout)
* **Bug Reporting**: Submit issues from the app interface

### Login & Verification

* Users must **sign in with a valid email**.
* A **verification code** is sent via email to confirm identity.
* Behaviour varies by environment:

  * **Development**: No emails sent, any email accepted, code = `DEV_VERIFICATION_CODE`.
  * **Testing**: Emails sent, only domains listed in `ALLOWED_DOMAINS` permitted.
  * **Production**: Emails sent, **any domain** permitted, but only `ALLOWED_DOMAINS` users can see admin features.

### Daily limits

The `DAILY_SEARCH_LIMIT` in `.env` controls how many new leases a user can view in 24 hours. Although in the interface it is shown as a search limit, it is linked to how many new leases a user views in a day. This design is intended to prevent users from scraping the data which is against the terms of use of the tool. 

The following do not count towards the daily limit:

* Re-views of bookmarked leases
* Re-views of leases previously accessed within the current session (resets it a user logs out)

To enable this, the database will store a record of the users bookmarks persistantly, however leases viewed in the session are stored within applications memory and deleted when a user logs out or a session expires.

### Lease Update Notifications

Whenever a user views a lease, the system records the data version they have seen. If a bookmarked lease is subsequently updated in a new data release, this is flagged to the user.

In the user's list of bookmarks, an "updated" flag will appear next to the changed lease. When they view the lease for the first time after an update, an information box is displayed notifying them that the record has changed. This alert also clarifies that the system cannot specify *what* has been updated; the ability to compare different versions of a lease is a planned future feature.

In addition to the in-app indicators, users receive an email notification about updated bookmarks, unless they have opted out. These emails are handled by the `send-bookmark-updates.js` script, a standalone process that runs independently of the main web application.

Here’s how the script works:
- It runs in a continuous loop, checking for updates every 24 hours.
- In each cycle, it retrieves the latest data version from the `LeaseUpdateLog`.
- It then iterates through all users who have opted-in to receive notifications.
- For each user, it compares the version last viewed of their bookmarked leases against the latest version recorded in the `LeaseTracker`.
- If any of a user's bookmarked leases have been updated, the script sends them a notification email.
- To prevent duplicate notifications, it logs which version update has been sent to each user.

To ensure the script runs reliably, it should be managed with a process manager like `pm2`:

```bash
pm2 start send-bookmark-updates.js --name lease-update-notifier
```

---

## 📊 Admin Dashboard

This is an hidden page available at /dashboard. It is accessible to users from domains listed in `ALLOWED_DOMAINS`.

Includes:

* Lease and user count  
* Search type statistics  
* Top viewed leases (all time & past month)  
* Dataset update logs  
* Bug report viewer  
* Login activity charts (daily/monthly/yearly)

---

## Bug reports

The application includes a self-contained bug reporting system, allowing users to report issues directly from the user interface.

Users can submit a bug report that includes:
* A description of the problem.
* The URL of the page where the bug occurred.
* An optional screenshot to provide visual context.

Submitted reports are stored in the database. Administrators (users from domains listed in `ALLOWED_DOMAINS`) can view all bug reports from the `/bugs` page, which is linked from the main admin dashboard.

### Handling Bug Reports

It is recommended that administrators regularly review submitted bug reports. If a report corresponds to a valid issue, it should be triaged and a corresponding issue created in the project's GitHub repository.

**Important:** When creating GitHub issues, administrators must be careful not to include any personal or sensitive information from the bug reports. This includes user emails and any personal data that might be visible in the screenshots provided by users. Screenshots should be reviewed carefully, and any sensitive details should be redacted before being attached to a public issue.

## 📂 Folder Structure

```
.
├── config/                  # Application configuration loader
├─- controllers/             # Core logic for the authorsation and lease routes
├─- data/                    # Working directory for data and database preparation
├── models/                  # Mongoose models
├── public/                  # Static assets
├── routes/                  # Route definitions and some control logic
├── uploads/                 # Where bug report screenshots go
├── utils/                   # Global utilities (email logic)
├── views/                   # EJS templates
├── .env.example             # Environment config
├── check-for-updates.js     # Stand alone script to check for data updates from UK Government
├── apply-update.js          # Stand alone script to dry-run and apply data updates
├── send-bookmark-updates.js # Stand alone script to check for updates to bookmarked leases and send users email alerts.
└── app.js                   # Main application entry point
```

### Views

The `views` directory contains all EJS templates, separated into the main views, partials used across multiple pages, and specific views for the bug reporting system.

*   `app.ejs`: The main application page for authenticated users. It includes the lease search functionality, bookmarked leases, and recently viewed leases.
*   `bug-report.ejs`: The form for submitting a new bug report.
*   `dashboard.ejs`: The admin dashboard, showing application statistics and links to administrative functions.
*   `error.ejs`: A generic page for displaying error messages.
*   `index.ejs`: The public-facing landing and login page.
*   `layout.ejs`: The main layout template that wraps all other views. It includes the primary HTML structure, header, footer, and cookie control.
*   `lease-details.ejs`: The detailed view of a specific lease, showing all its properties and allowing users to bookmark or unbookmark it.
*   `lease-guidance.ejs`: A static page providing guidance on understanding lease data.
*   `not-found-help.ejs`: A static page offering help if a user cannot find their lease.
*   `profile.ejs`: The user profile page where users can manage their data and perform a Subject Access Request (SAR).
*   `verification-sent.ejs`: A confirmation page shown after a user has been sent a login verification email.
*   `verified.ejs`: A page confirming that a user's email has been successfully verified.

#### Partials

*   `partials/cookie-control.ejs`: Manages the cookie consent banner and Google Analytics integration.
*   `partials/footer.ejs`: The site-wide footer.
*   `partials/header.ejs`: The site-wide header and main navigation.

#### Bugs

*   `bugs/thank-you.ejs`: A confirmation page shown after a user successfully submits a bug report.
*   `bugs/view.ejs`: The admin page for viewing, managing, and deleting submitted bug reports.

---

## ✅ Deployment Tips

* Use a reverse proxy (e.g. Nginx) for HTTPS and domain routing
* Use a process manager like PM2 to ensure uptime
* Set up a cron job to check for updates (e.g. run `update-dataset.js` daily)
* Configure MongoDB backups and monitoring