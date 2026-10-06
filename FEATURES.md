# Feature list

Everything My Watch Later does, written as a checklist you can follow.

**Want to build your own version?** You are welcome to. Treat this file as a spec: pick the features you want,
skip the ones you don't, and use the "rules worth copying" and the build order at the end to avoid the traps I
fell into. Each section says what the feature does, the rules it follows, and where it lives in this repository so
you can read the real code.

Contents: [Saving](#1-saving-videos) · [The dialog](#2-the-dialog) · [Filters and sorting](#3-filters-and-sorting) ·
[Time to finish](#4-time-to-finish) · [Missing data](#5-missing-data) · [Tags](#6-tags) ·
[Bulk actions](#7-bulk-actions) · [Should Rewatch and the prompt](#8-should-rewatch-and-the-red-prompt) ·
[YouTube's own list](#9-youtubes-own-watch-later-list) · [History and stats](#10-history-and-stats) ·
[Settings and backup](#11-settings-and-backup) · [Page behavior](#12-page-behavior-on-youtube) ·
[Data model](#data-model) · [Rules worth copying](#rules-worth-copying) · [Suggested build order](#suggested-build-order) ·
[Not included](#not-included)

---

## 1. Saving videos

**Right-click to save** · `background.js`, `lib/metadata.js`, `lib/storage.js`

- [x] A context-menu item **Add to My Watch Later**, shown on links, on videos and on the page, on youtube.com only.
- [x] Works on watch links, `youtu.be` links, Shorts, embeds and live links (`parseVideoId` in `lib/model.js`).
- [x] Saves the video's title, channel, length, views and published date by reading the video's normal watch page
      (the `ytInitialPlayerResponse` data in the page).
- [x] If the page can't be read, the video is still saved using what the right-clicked card showed (title and channel).
      The page remembers what you right-clicked and tells the background script when asked.
- [x] Saving the same video twice keeps the first copy and says "Already in My Watch Later".
- [x] Confirmation without needing the page: a ✓ (or ! / ?) flashes on the toolbar icon.
- [x] A notice on the page with a small box to **add a tag** right away.
- [x] Saving never fails because of the history log (see [rules](#rules-worth-copying)).

## 2. The dialog

**The main screen** · `content/overlay.js`, `content/overlay.css`

- [x] Lives in a **shadow DOM** so YouTube's styles can't touch it, and so it can't break YouTube's layout.
- [x] A floating button **▶ My Watch Later** with the number of waiting videos, on every YouTube page.
- [x] Opens on its own on the youtube.com home page (optional), and in place of YouTube's own Watch Later page
      (`/playlist?list=WL`, optional). Closing it shows YouTube's original list as an escape hatch.
- [x] Also opens from the toolbar popup. If no YouTube tab is open it opens one (`?mwl=1`, which is then removed
      from the address).
- [x] Two tabs, **Watch Later** and **Should Rewatch**, each with a count, plus a **📊 Stats** tab.
- [x] **Cards view**: thumbnail with length, title, channel, views, published date, tag chips, and buttons.
- [x] **Table view**: checkbox, thumbnail, title, channel, length, views, published, saved, tags, row buttons.
      Click a column title to sort; click again to flip.
- [x] Your view choice is remembered. The default is cards.
- [x] Clicking a video opens it on YouTube. Esc, the ✕ button or the backdrop closes the dialog.
- [x] Estimated dates are shown as `~Mar 2023`; hovering a card shows when it was published and saved.
- [x] Friendly empty states ("Your Watch Later list is empty", "No videos match these filters" with a Clear button).
- [x] **Dark mode** follows YouTube's own theme.
- [x] **Hidden while anything is fullscreen**, and comes back when you exit.
- [x] Notices (toasts) with an **Undo** button, a tag box, or action buttons.

## 3. Filters and sorting

**Find what you want** · `lib/filters.js`, `content/overlay.js`

- [x] **Search** across title, channel and tags.
- [x] **Channel** dropdown (with counts) and **Tag** dropdown (with counts), built from the current tab.
- [x] Four **range filters**: Length, Views, Published, Saved. Each has presets and **Custom range…**:

  | Filter | Presets | Custom range typed as |
  | --- | --- | --- |
  | Length | Under 10 min · 10–30 · 30–60 · Over 1 hour | minutes (`5` to `20`, decimals allowed) |
  | Views | Under 10K · 10K–100K · 100K–1M · Over 1M | `10k`, `1.5M`, `2,000` |
  | Published, Saved | Last 7 days · 30 days · 3 months · year · Older than 1 year | a date |

- [x] Custom ranges include both ends. The whole "to" day counts. Leave one side empty for "at least" / "at most".
      If "from" is larger than "to" they are swapped.
- [x] A video whose value is **unknown never matches** an active filter on that value, and the summary line says how
      many are hidden for that reason ("88 hidden: published unknown"), so a filter that shows nothing is explained.
- [x] **Sort**: recently or oldest saved, newest or oldest published, shortest or longest, most or least viewed,
      title A–Z or Z–A, channel A–Z or Z–A. Missing numbers always sort last, in either direction.
- [x] **Clear** resets every filter.

## 4. Time to finish

**"How many hours is my list?"** · `lib/filters.js`

- [x] Adds up the lengths of the videos currently shown (so it follows your filters and the tab).
- [x] Written in **months, days, hours and minutes**, skipping zero units: `7d 9h 54m`. A day is 24 hours and a month
      is 30 days.
- [x] Also shown as plain numbers: `177.9 hours · 7.4 days`.
- [x] A **playback speed** setting (1x, 1.25x, 1.5x, 1.75x, 2x) divides the total. Remembered.
- [x] Videos with no known length are not in the total; the line says how many ("+ 3 without length").

## 5. Missing data

**Some data is not available the moment you save or import** · `lib/metadata.js`, `lib/model.js`, `content/overlay.js`

- [x] **Data check** panel: how many videos have length, views and channel, and how many published dates are
      exact, estimated or missing.
- [x] **Estimated published date** on import, from YouTube's "2 years ago" text (the middle of the range). Stored with a
      flag so it can be told apart from an exact date.
- [x] **Fill missing details** button: reads each video's watch page (two at a time, with a short pause) and replaces
      estimates and gaps with exact values. It shows progress, can be stopped, and stops by itself if YouTube asks it to
      slow down (HTTP 429).
- [x] Re-importing fills gaps in videos you already have but never overwrites what is known, and never replaces an
      exact date with an estimate.

## 6. Tags

**Your own labels** · `lib/model.js`, `lib/storage.js`

- [x] Add a tag from the "Saved" notice, from a card's **+ tag**, or in bulk.
- [x] Tags are lowercase, trimmed, without a leading `#`, up to 30 characters, no duplicates.
- [x] Click a tag chip to filter by it; click **×** to remove it.

## 7. Bulk actions

**Mass editing in the table view** · `content/overlay.js`, `lib/storage.js`

- [x] Tick a row's checkbox, or click anywhere on the row. **Shift-click** ticks the range between two rows.
- [x] The header checkbox ticks or unticks everything the filters show, with a "partly ticked" state.
- [x] A bar above the table: **Select all filtered (N)**, **Uncheck all**, **Invert**.
- [x] **Move** the ticked videos to the other tab (with Undo).
- [x] **Add a tag** to all ticked videos, or **remove a tag** from them (the dropdown lists the tags they have).
- [x] **Remove selected**: asks first (Cancel is the default button), then offers Undo for 20 seconds.
- [x] **Ticks are always a subset of what is visible.** Changing a filter or tab unticks rows that disappear, so a bulk
      action can never touch a video you cannot see.
- [x] Ticking never rebuilds the table, so it stays fast with thousands of rows.
- [x] Every bulk action is one storage read and one write, however many videos.

## 8. Should Rewatch and the red prompt

**A second list, and a nudge at the right moment** · `content/overlay.js`

- [x] **↻ Should Rewatch** moves a video to the second tab; **↩ Back to Watch Later** moves it back (with Undo).
- [x] When you open a video that is in your Watch Later list, a **red prompt** appears with
      **🔁 Should Rewatch · 🗑️ Remove · 👍 Keep**. It stays until you choose.
- [x] It comes back as **"🎉 Finished this one?"** in the last 5 seconds (or when the video ends), once per video.
- [x] It only reacts to the main player: not hover previews, and not ads.
- [x] **Minimize** button shrinks it to a small pill; click the pill to open it. The choice is remembered. The "finished"
      version always opens full size.
- [x] It closes by itself if you leave the video, or if the video is removed or moved elsewhere.
- [x] Can be switched off in Settings.
- [x] **Remove** after finishing is logged as *done*; removing a video you never watched is logged as *manual*.

## 9. YouTube's own Watch Later list

**Bring it in, or clear it out** · `content/native-wl.js`

YouTube gives extensions no API for this list, so both features read and click the page. Everything that touches
YouTube's page is in `native-wl.js`, so a layout change is a one-file fix.

- [x] **Import from YouTube Watch Later** (shown on `youtube.com/playlist?list=WL`): scrolls until the whole list is
      loaded, then copies title, channel, length, views and an estimated published date. YouTube's order is kept.
- [x] **Remove all from YouTube Watch Later…**: clicks "Remove from Watch later" for each video, from the top.
  - [x] Warns that it empties the real list on every device and cannot be undone.
  - [x] **Copies everything into My Watch Later first** (ticked by default) and checks every video was saved before
        removing anything. If the copy fails, nothing is removed.
  - [x] You must type `REMOVE` to enable the button.
  - [x] Progress ("120 of 800") and a **Stop** button.
  - [x] Stops after 3 failures in a row and says how many were removed.
  - [x] Needs YouTube in English (it finds the menu item by its text).

## 10. History and stats

**What have I added, finished and thrown away?** · `lib/events.js`, `lib/insights.js`, `lib/storage.js`, `content/stats.js`

### The log

- [x] One small line per action, kept in local storage, split into one list per month.
- [x] Events: **added** (right-click / import / backfill), **finished**, **removed** (done / manual / bulk / clear),
      **restored** (Undo), **moved**, **tagged**, **prompt** (which button was pressed).
- [x] **Undo cancels the removal it undid**, so an undone removal never counts.
- [x] A **daily snapshot** of how many videos are waiting and how long they are (for the list-size chart).
- [x] **Backfill**: on first run, videos you already had become "added" events dated when you saved them. A batch that
      was imported in one go is recognised (saved exactly 1 second apart) and marked as an import.
- [x] Capped at the latest 20,000 events; the oldest go first.
- [x] Can be switched off, cleared, exported and imported without duplicates.

### The Stats tab

- [x] Range: 7 days, 30 days, 90 days, 1 year, all time. Bars are per day, week or month depending on the range
      (weeks start on Monday).
- [x] **Include imported videos** checkbox (off by default, so a one-off import doesn't flatten the charts).
- [x] **Tiles**: added, finished, finish rate, thrown away (removed without finishing), waiting now (with time to
      watch), streak.
- [x] **Added vs finished** bar chart and **List size over time** line chart. Both have a legend or direct label, hover
      details, and a "View as table".
- [x] **Insights**, in plain words, each saying "not enough data yet" instead of inventing a number:
  - [x] your pace per week, and how long until the list would be empty (or that it is growing)
  - [x] hours added versus hours finished per week
  - [x] how long videos wait before you finish them (median and average)
  - [x] videos waiting more than 90 days, with a **Review in list** button that filters to them
  - [x] finish rate by length, and the channels you finish most and least
  - [x] the weekday and hour you finish the most
  - [x] your current and longest streak
  - [x] how many finished videos went to Should Rewatch
- [x] Breakdown bars: finish rate by length, top channels, finishes by weekday.

## 11. Settings and backup

**Toolbar popup and settings page** · `popup/`, `options/`

- [x] Popup: counts for both lists, **Open my list**, and a link to settings.
- [x] Settings: replace YouTube's Watch Later page, open on the home page, show the prompt, keep history.
- [x] **Export** the list and history to a JSON file; **Import** it back. Older files without history still import.
- [x] **Clear history** and **Delete all saved videos** (both ask first).

## 12. Page behavior on YouTube

**Making it behave on a single-page app** · `content/overlay.js`, `content/loader.js`

- [x] YouTube never reloads between pages, so the script listens for YouTube's navigation event and also checks the
      address every 0.8 seconds as a backup.
- [x] A short loader script imports the real module, because content scripts can't be ES modules directly.
- [x] **Reloaded-extension safety**: after you reload the extension, old copies in open tabs notice they are cut off
      and shut themselves down instead of throwing "Extension context invalidated".
- [x] Keyboard shortcuts typed in the dialog (space, f, k…) don't reach YouTube.
- [x] Redraws are throttled while details are loading, so a large table doesn't flicker.

---

## Data model

Stored in `chrome.storage.local`.

| Key | Holds |
| --- | --- |
| `videos` | A map of video id → record (below) |
| `settings` | The settings (below), plus a `schema` number for migrations |
| `events:YYYY-MM` | The history log for one month (a list of events) |
| `historyMeta` | `{ count, months, backfilled }` for the log |
| `snapshots` | `{ 'YYYY-MM-DD': { n, sec, rn } }` — waiting count, waiting seconds, rewatch count |

**A video record**

| Field | Meaning |
| --- | --- |
| `id` | The 11-character YouTube video id |
| `title`, `channel` | As shown on YouTube |
| `durationSec`, `views` | Numbers, or `null` when unknown |
| `publishedAt` | When it went up on YouTube (milliseconds), or `null` |
| `publishedApprox` | `true` when `publishedAt` is only an estimate |
| `detailsAt` | When its details were last read from YouTube, or `null` |
| `thumbnail` | Always derived from the id, never trusted from a file |
| `addedAt`, `movedAt` | When it was saved / last moved (milliseconds) |
| `list` | `watchLater` or `rewatch` |
| `tags` | A list of cleaned tags |

**Settings**: `overrideWatchLater`, `autoOpenHome`, `promptOnFinish`, `promptMinimized`, `playbackSpeed`, `view`,
`keepHistory`.

**An event**: `{ t, type, id }` plus a few optional fields (`source`, `reason`, `to`, `tag`, `choice`, `kind`,
`channel`, `durationSec`). Anything else in an imported file is dropped.

## Rules worth copying

These are the decisions that made the extension trustworthy. They are cheap to build in from the start.

1. **Unknown is not zero.** Missing numbers stay `null`, never match a filter on that value, sort last, and are
   counted out loud ("N hidden", "+ N without length").
2. **A bulk action only touches what you can see.** Selection is pruned to the visible rows whenever the view changes.
3. **Anything destructive asks, defaults to the safe button, and offers Undo** (or a verified backup first).
4. **History must never break saving.** Its errors are logged and swallowed.
5. **Undo cancels its removal in the stats** instead of counting a removal and an add.
6. **Estimates are labeled.** An estimated date carries a flag, is shown with `~`, and an exact value always replaces it.
7. **Imports never overwrite known data**, and re-importing fills gaps only.
8. **Keep everything that touches YouTube's page in one file**, so a layout change is a small fix.
9. **Treat video titles as text, never HTML.** The UI helper builds elements with text content only.
10. **Say "not enough data" instead of inventing a number**, in every insight.
11. **Keep the logic pure and testable.** Filtering, history maths and insights are plain functions with no browser
    code, and storage is tested with an in-memory stand-in.

## Suggested build order

Each step is usable on its own.

1. Manifest, right-click menu, save to `chrome.storage.local`, toolbar popup with a count.
2. The dialog with cards, opening on YouTube, and Remove.
3. Search, filters, sorting, tags.
4. Custom ranges and the time-to-finish total.
5. Should Rewatch tab and the prompt.
6. Table view and bulk actions.
7. Import, then **Fill missing details**, then **Data check**.
8. Settings page, export and import.
9. History log, then the Stats tab.
10. Remove-all from YouTube's own list (last, because it is the riskiest).

## Not included

- Syncing between devices or accounts.
- Anything that sends your data to a server, and any analytics about you.
- A YouTube API key. Reading the page is enough for what this does.
- Safari, Firefox or mobile browsers (this is a Manifest V3 Chromium extension).
- Tracking videos that are not in your list, or your general YouTube history.
