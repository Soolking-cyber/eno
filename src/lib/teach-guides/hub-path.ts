/**
 * The teacher library's hub path, in a module with NO imports — so client code (the footer, the home teacher shelf, the
 * /c teaching links) can link the hub without the registry, which imports all 41 guides' content (1.4 MB of JSON).
 * registry.ts re-exports it as TEACH_BASE; footer.test.tsx keeps this file import-free.
 */
export const TEACH_HUB_PATH = '/teach-in-vietnam'
