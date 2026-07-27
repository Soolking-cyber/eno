# T337 — measured evidence (alex, 2026-07-27)

Owner symptom: "visa apply send form again opens new chat".
Earlier symptom: HTTP 500 on POST /api/conversations.
**Both are the same defect.**

## The shared desk
    desk seller   cmqumj6s3000004kzfx64tlh1
    listings      15  = 14 visa (subcategorySlug 'visa-legal') + 1 trip anchor
    trip anchor   377a016d-1251-4582-b603-99506f05e34b
                  "Vietnam trip planning — free itinerary, and we can book it for you"

`Seller.ownerId` is @unique, so visa and trips are ONE storefront. Any rule keyed on
"which seller is this?" cannot tell a visa thread from a trip thread.

## Chain of causation (proven)
1. Visa thread exists, anchored on a visa catalogue listing.
2. Itinerary "book it for you" -> POST /api/conversations.
3. route.ts:109-117 finds ANY thread with that seller (seller-level reuse) and,
   since listingId differs, RETARGETS it:
       db.conversation.update({ where:{id}, data:{ listingId } })
   The visa thread's anchor is now the TRIP listing.
4a. Next visa apply: src/lib/visa/dm-thread.ts:227-230 looks up
       findFirst({ sellerId, buyerProfileId, listingId: { in: visaListingIds } })
    -> MISS (anchor is no longer a visa listing) -> creates a NEW conversation.
       == "opens new chat"
4b. If (trip anchor, buyer) already exists, the same update violates
       @@unique([listingId, buyerProfileId])
    -> P2002, and that update is OUTSIDE the try/catch guarding the sibling create()
    -> unhandled -> HTTP 500.

## Prod state at time of probe (6 desk conversations)
    2 threads carry visaApplicationId but are anchored on the TRIP listing:
        cmrvk2xnl000001s6szcl3oaz   last message 2026-07-27T07:55
        cmrvl74e6000d01s67lwl6de0
    1 buyer holds 2 desk threads (the duplicate the owner sees):
        buyer 562fa1d5...
          cmrvk2xnl0  listing=377a016d [TRIP]  visaApp=yes  last 07:55
          cms1v7yg50  listing=cmrwxrwnd0 [VISA] visaApp=yes  last 05:32

Both threads hold real messages. A repair must not blind-delete either.

## Reproduce
Same buyer: open a visa application, then use the itinerary "book it for you"
flow, then start a visa application again -> a second chat appears.

## Probe
A throwaway tsx script against DIRECT_URL grouping Conversation by
(sellerId = desk, buyerProfileId) and flagging rows where
visaApplicationId IS NOT NULL AND listingId = trip anchor.
