# AttendX 0.4.0 structure

```text
attendx/
├── backend/
│   ├── src/server.js             # Express API, lecturer accounts, signed auth, SQLite, GPS checks, Excel export
│   ├── package.json
│   └── .env.example
└── frontend/
    ├── index.html
    ├── vite.config.js
    ├── package.json
    └── src/
        ├── main.jsx
        ├── App.jsx                # Portal routing, lecturer auth and lecturer workflow
        ├── style.css
        ├── components/
        │   ├── Header.jsx
        │   ├── HomeView.jsx
        │   ├── LecturerAuth.jsx   # Lecturer registration and login
        │   ├── LecturerDashboard.jsx
        │   ├── StudentCheckIn.jsx # Student login, fixed timer, GPS check-in, success screen
        │   ├── AttendanceTable.jsx
        │   └── Notice.jsx
        ├── services/api.js
        └── utils/device.js
```

All application code is JavaScript/JSX. See `README.md` for installation, API endpoints and security limitations.
