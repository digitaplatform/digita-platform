// Vendor ESM for the whole react-router family in ONE module. react-router-dom@7
// re-exports react-router (core) and pulls react-router/dom; bundling react-router-dom
// here (externalizing only react) yields a single module object, so host + plugin
// share ONE RouterContext. The import-map points react-router, react-router-dom AND
// react-router/dom all at this file. Without this single-instance guarantee, a
// plugin's NavLink/useNavigate would read a different (empty) router context.
export * from 'react-router-dom';
