// Vendor ESM for the @digitaplatform/plugins SDK. This module holds the host-services
// singleton (provideHostServices sets a module-level `host`; useHost reads it),
// so host AND plugins MUST import this ONE instance — hence both externalize
// @digitaplatform/plugins and resolve it here via the import-map. The SDK only
// type-imports react (erased), so react stays external/unused at runtime.
export * from '@digitaplatform/plugins';
