// Vendor ESM for react-dom/client (createRoot/hydrateRoot). main.tsx imports the
// default (`import ReactDOM from 'react-dom/client'; ReactDOM.createRoot(...)`),
// so re-export both the default object and the named entries. Shares the react +
// react-dom chunks via the splitting build (one reconciler instance).
import ReactDOMClient from 'react-dom/client';
export default ReactDOMClient;
export const { createRoot, hydrateRoot } = ReactDOMClient;
