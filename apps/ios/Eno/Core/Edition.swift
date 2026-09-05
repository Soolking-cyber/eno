import Foundation

// ── WHICH EDITION IS THIS BUILD? ────────────────────────────────────────────────────────────────
//
// The Swift counterpart of `src/lib/edition.ts`. One codebase, two apps:
//
//   · MARKETPLACE — eno.vn, the LICENSED marketplace. Visa, itinerary and PayPal may never appear.
//   · SERVICES    — eno.forum, where those are live.
//
// ⛔ WHY A CONSTANT AND NOT A LITERAL, WRITTEN DOWN BECAUSE THE WEB ALREADY PAID FOR IT. edition.ts
// exists because 58 page titles across the web app ended in a hardcoded "| eno.vn", so every page on
// eno.forum — the e-Visa product pages included — was titled with the LICENSED company's name. It was
// found by curling the live domain, not by any gate. The same class of bug is one string literal away
// in Swift, and this app had `eno.vn` hardcoded in a dozen files.
//
// ⚠️ THE CATALOGUE DIFFERENCE IS THE SERVER'S JOB, NOT THIS FILE'S. Which listings each edition may
// show is decided by `src/lib/edition-scope.ts` on the API side, so simply pointing the app at the
// right host yields the right catalogue. This constant carries only what the CLIENT needs to know:
// where to talk, what to call itself, and which features it is allowed to render.
//
// ⚠️ SELECTED AT COMPILE TIME by the `ENO_SERVICES` flag in the EnoForum target's
// SWIFT_ACTIVE_COMPILATION_CONDITIONS (project.yml). A compile-time choice — rather than a runtime
// env read — is what lets the compiler strip the other edition's branches out of the binary, the
// same property the web relies on the minifier for.

enum Edition {
    #if ENO_SERVICES
    static let isServices = true
    #else
    static let isServices = false
    #endif

    static var isMarketplace: Bool { !isServices }

    /// The bare host — also the brand name, exactly as `SITE_NAME` is on the web.
    static var siteName: String { isServices ? "eno.forum" : "eno.vn" }

    /// Every API call and every web sheet resolves against this.
    static var baseURL: URL { URL(string: "https://\(siteName)")! }

    /// Hosts this app treats as its own for in-app navigation. `www.` is included because the
    /// services edition serves it (the deploy's own health check hits https://www.eno.forum/).
    static var ownHosts: Set<String> { [siteName, "www.\(siteName)"] }

    /// The support mailbox, per edition — the mirror of `COMPANY.email` in `src/lib/site-legal.ts`,
    /// whose header records that these addresses carry BINDING published commitments with deadlines
    /// attached. Never compose one from the brand name at a call site.
    static var supportEmail: String { isServices ? "support@eno.forum" : "support@eno.vn" }

    /// ⛔ VISA AND ITINERARY ARE SERVICES-ONLY, AND THIS IS A LICENSING BOUNDARY, NOT A PREFERENCE.
    /// The marketplace edition must not render them at all. Nothing in the native app builds them
    /// yet — gate every future screen on this rather than on a host comparison at the call site.
    static var showsVisaAndItinerary: Bool { isServices }

    /// ⛔ THE CUSTOM URL SCHEME, AND IT MUST BE PER-EDITION OR SIGN-IN LANDS IN THE WRONG APP.
    /// Each target registers its own scheme in its Info.plist, but the OAuth callback URL was
    /// hardcoded to the marketplace's — so on a phone with both apps installed (the stated
    /// transition setup) finishing sign-in in the services app handed the code to eno.vn, and on a
    /// phone with only the services app it resolved to nothing at all. The scheme is edition state
    /// like the host is; it belongs here next to it.
    /// ⚠️ Registering it is only half the job: `enoforum://auth-callback` must ALSO be added to the
    /// Supabase redirect allowlist for the services project, which is owner-side config and has no
    /// compiler to catch a half-applied change.
    static var urlScheme: String { isServices ? "enoforum" : "enonative" }

    /// ⛔ PAYMENTS ARE A SERVICES-EDITION SURFACE, and the gate is the same legal line as visa and
    /// itinerary. The web keeps the whole section off the licensed marketplace with `.forum.svc.`
    /// page extensions ("how a seller gets paid" — bank payout and the custody wallet); on the
    /// marketplace build those routes do not exist, so a screen that called them would 404.
    static var showsPayments: Bool { isServices }
}
