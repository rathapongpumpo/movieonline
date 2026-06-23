# Site Source Inspector

Paste a website URL and inspect:

- image/video sources loaded by the browser
- DOM media sources
- internal links
- menus from header/nav/footer/navigation roles

## Run

```bash
npm install
npx playwright install chromium
npm run dev
```

Open `http://localhost:3000`.

## Google Sheets export

SQLite remains the primary database. To enable the admin "ส่งออก Google Sheet" button, create a Google service account, share the target spreadsheet with that service account email, then set:

```bash
GOOGLE_SHEET_ID=your_spreadsheet_id
GOOGLE_SERVICE_ACCOUNT_JSON={"client_email":"...","private_key":"..."}
```

Alternatively set `GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY` separately. The export overwrites snapshot tabs named `Videos`, `Series`, `Episodes`, and `Categories`.
