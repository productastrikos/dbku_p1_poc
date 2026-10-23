import React from 'react';
import ReactDOM from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './index.css';
import App from './App';
import { initTheme } from './theme/ThemeProvider';

initTheme(); // before first paint, so the saved theme never flashes

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
