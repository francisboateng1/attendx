import React from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './style.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
    throw new Error('Could not find the root element. Check frontend/index.html.');
}

createRoot(rootElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
