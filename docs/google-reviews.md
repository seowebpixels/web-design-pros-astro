# Google review slider

The homepage, Services overview and individual service pages share `src/components/GoogleReviews.astro`. Four review cards appear on desktop, two on medium screens and one on small screens. Readers can use the buttons, keyboard or native touch scrolling. There is no automatic rotation or third-party widget.

Edit the verified review excerpts and links in `src/data/google-reviews.ts`. Seven reviewers and their five-star ratings were read on the public Web Design Pros Google Maps listing on 15 November 2026. Preserve the published names and quotation wording, including spelling. Excerpts are explicitly labelled and kept short; the complete original reviews remain on Google.

The rating and total are a dated manual snapshot, not a live Google integration. Recheck the listing before changing them. Individual review dates were only shown as relative dates by Google, so the public cards do not invent exact publication dates.

All source links go to the verified Google reviews listing unless an individual Google share link has been verified. Currently the Thamendhran Nair card has an individual share link; the other cards open the business's reviews tab. Google’s clipboard controls did not reliably supply the remaining individual share URLs. Add them to the corresponding `url` fields if supplied or subsequently verified. Do not label a profile link as a direct permalink to one specific review.

No self-serving Review or AggregateRating JSON-LD is added. The initials shown on cards are text avatars, not invented reviewer photographs or verification badges.
