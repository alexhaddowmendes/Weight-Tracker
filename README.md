# Weight Tracker

A simple static website for Alex and Rochelle to log their weight once a day and see a combined line graph. The site is hosted on GitHub Pages, and the data lives in a private Google Sheet written through a small Google Apps Script web app.

## One-time setup

1. Create a new Google Sheet.
2. Open **Extensions > Apps Script**, replace the contents with [`apps-script/Code.gs`](apps-script/Code.gs) and save.
3. Click **Deploy > New deployment > Web app**. Set **Execute as: Me** and **Who has access: Anyone**, then deploy and authorise.
4. Copy the web app URL into `API_URL` in [`config.js`](config.js).
5. In the GitHub repo, go to **Settings > Pages** and serve the `main` branch, root folder.

## Updating the Apps Script

When `apps-script/Code.gs` changes (for example the eating-day tracker, which adds an `Eating` sheet), paste the new version into the Apps Script editor, then **Deploy > Manage deployments > Edit (pencil) > Version: New version > Deploy**. The web app URL stays the same.

## Notes

- Eating day (good / OK / bad) is optional. It is stored in the `Eating` sheet, one rating per person per day, and can be changed during the day.

- Each person has one entry per day. Saving again on the same day overwrites it.
- There is no login. Anyone with the script URL can write to the sheet, which is an accepted trade-off for a two-person site.
- Dates use the browser's local calendar day.

## Run locally

```bash
python -m http.server 8000
```
