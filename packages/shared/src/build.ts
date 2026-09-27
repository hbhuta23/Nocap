// Build id stamped by the extension's esbuild step into both the extension and the daemon bundle.
// Lets the extension notice a daemon left over from an older build (after an update or F5) and replace it.
declare const __NOCAP_BUILD__: string;
export const BUILD_ID: string = typeof __NOCAP_BUILD__ === 'string' ? __NOCAP_BUILD__ : 'dev';
