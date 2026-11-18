# Points & Attendance

A phone-friendly web app for tracking points and attendance by week, shared live between leaders.

- **Locations & rooms:** each location (e.g. Higher Ground, Awana) has its own rooms. Each room has its own kids, point categories, attendance points, and leaderboard.
- **Attendance** (first tab): tap kids who are here. A dropdown switches between the rooms you can access.
- **Points:** only kids marked present are listed (toggle to see all). Tap a kid, then tap category buttons.
- **Board:** weekly and all-time rankings for the room.
- **Settings (admins only):** locations & rooms, leaders (usernames, passwords, room access), and per-room kids, categories, attendance points, import, and CSV backup.
- **Sign-in:** username + password, no email needed. Admins create leaders and can set or reset anyone's password.
- **Roles:** admins can do everything in every room; leaders take attendance and give points only in the rooms they're given.
- Weeks run **Wednesday to Tuesday**.

It's plain HTML/CSS/JS with no build step. Data lives in Firebase Firestore; `firestore.rules` enforces room access on Google's servers.

## Set up Firebase (free, ~10 min)

Until this is done the app runs in **demo mode**, with no login and data saved on one device only.

1. Go to <https://console.firebase.google.com>, click **Create a project**, and name it (e.g. `higher-ground`). Google Analytics can be turned off.
2. **Database:** open **Build → Firestore Database**, click **Create database**, pick a location near you, and start in **production mode**.
3. **Rules:** in Firestore, open the **Rules** tab, replace everything with the contents of `firestore.rules` from this repo, and click **Publish**.
4. **Sign-in:** open **Build → Authentication → Get started**. Under **Sign-in method**, enable **Email/Password** (and optionally **Google** for older accounts).
5. **Authorized domains:** in Authentication, go to **Settings → Authorized domains → Add domain** and add `dbc-jace.github.io`.
6. **Web app config:** go to **Project settings** (gear icon) → **Your apps**, click the **</>** (Web) icon, and register the app. A nickname is all it needs; leave Hosting unchecked. Copy the `firebaseConfig` values into `firebase-config.js` and commit. These values are meant to be public; the rules are what protect the data.

The free "Spark" plan is plenty for this app, and no credit card is required.

## Put it online (GitHub Pages)

The repo must be **public** for free GitHub Pages.

1. Merge this code into `main`.
2. On GitHub, go to **Settings → Pages**, set Source to **Deploy from a branch**, choose `main` and `/ (root)`, and click **Save**.
3. After a minute the app is live at `https://dbc-jace.github.io/Points-App/`.

On a phone, use **Share → Add to Home Screen** so it opens like an app.

> Changing visibility on a phone: open github.com/dbc-jace/Points-App/settings in the browser (the GitHub app can't do it), scroll to **Danger Zone → Change visibility**. If the page looks broken, turn on "Request Desktop Website."

## First use

1. Open the link and sign in. The first admin is set up once; after that, admins add everyone else.
2. **Settings → Locations & rooms:** add locations (e.g. Awana) and their rooms (e.g. Sparks). New rooms can copy point categories from an existing room.
3. **Settings → Leaders:** add each leader with a name, username, password, role, and rooms. Tell them their username and password.
4. Use the room picker in Settings to choose a room, then add its kids, categories, and attendance points.

Forgot a password? An admin opens **Settings → Leaders → Edit → Set a new password**. (Behind the scenes this gives the leader a fresh login with the same username; the old one stops working.)

Upgrading from the single-room version: publish the new `firestore.rules` first, then an admin opens the app once. Existing data moves into a "Higher Ground" location and room, and existing leaders keep their email as their username with the same password.

## About security & privacy

- The **code** is public, but the **data** (names, points, attendance) lives in Firebase and is only readable by signed-in leaders, and only for the rooms they've been given. The rules in `firestore.rules` enforce this on Google's servers, not just in the app.
- Only admins can change people, categories, settings, or the leader list.
- Keep data light: first names (or first name + last initial) are enough. Don't store birthdays, phone numbers, or addresses.
- Never commit CSV exports or screenshots of the data to this repo.

## Run locally

```
python3 -m http.server 8000
```
Then open http://localhost:8000.
