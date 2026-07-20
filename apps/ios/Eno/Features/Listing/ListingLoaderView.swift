import SwiftUI

// Deep-link target for /listings/<id> (audit #3): a shared link or notification
// carries only an id, but ListingDetailView paints from a ListingCard — so load the
// detail envelope by id, synthesize a card, then hand off (the detail view re-fetches
// the same GET to hydrate the rest). Shows the sold/removed state on a 404, same as
// tapping a stale card.
struct ListingLoaderView: View {
    let id: String
    @State private var card: ListingCard?
    @State private var unavailable = false

    var body: some View {
        Group {
            if let card {
                ListingDetailView(card: card)
            } else if unavailable {
                VStack(spacing: 6) {
                    Text("🚫").font(.system(size: 34))
                    Text(L10n.tr("This listing is no longer available", "Tin này không còn nữa"))
                        .font(.system(size: 16, weight: .bold)).foregroundStyle(Tokens.fg)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 40)
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
            }
        }
        .task {
            guard card == nil, !unavailable else { return }
            do {
                let env: ListingDetailEnvelope = try await APIClient.shared.get("api/listings/\(id)")
                card = env.listing.asCard
            } catch {
                unavailable = true
            }
        }
    }
}

extension ListingDetail {
    // Project the detail back onto a card for instant paint. goodPrice/verified/
    // brandSlug/model aren't in the detail payload — default them (the card only
    // uses them for badges, which the detail view recomputes anyway).
    var asCard: ListingCard {
        ListingCard(
            id: id, title: title, titleVi: titleVi, price: price, priceUnit: priceUnit,
            currency: currency, negotiable: negotiable, prevPrice: prevPrice, urgent: urgent,
            location: location, district: district, city: city, images: images, video: video,
            goodPrice: false, verified: true, postedAt: postedAt, savedCount: savedCount,
            contactCount: contactCount, brandSlug: nil, model: nil, lat: nil, lng: nil, category: category,
            seller: ListingCard.CardSeller(trustScore: seller.trustScore, isBusiness: seller.isBusiness)
        )
    }
}
