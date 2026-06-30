// Vitest stub for `server-only`: that package throws if imported outside a React Server
// Component. Unit tests exercise the pure logic of server-only modules (e.g. the OAuth JWT
// crypto) in a plain Node context, so we alias the import to this empty module.
export {}
