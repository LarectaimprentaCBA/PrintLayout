import React from 'react';
import ReactDOM from 'react-dom/client';
import QuickPrintApp from './quickprint/QuickPrintApp.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QuickPrintApp />
  </React.StrictMode>,
);
