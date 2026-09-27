/**
 * Default CMS content. Seeded once; after that, everything here is edited in
 * Admin → Homepage / Pages and the seed never overwrites existing content.
 *
 * Copy avoids factual claims the owner hasn't provided (years in business,
 * history, awards, customer counts, credentials). Policy pages are ORIGINAL
 * DRAFTS and are flagged `reviewRequired` for owner/legal review.
 */

export type ImageKey = string;

export interface SeedItem {
  eyebrow?: string;
  title?: string;
  body?: string;
  image?: ImageKey;
}

export interface SeedSection {
  key: string;
  visible?: boolean;
  eyebrow?: string;
  heading?: string;
  subheading?: string;
  body?: string;
  image?: ImageKey;
  primaryCta?: [string, string];
  secondaryCta?: [string, string];
  items?: SeedItem[];
}

export interface SeedPage {
  slug: string;
  title: string;
  seoTitle?: string;
  seoDescription?: string;
  body?: string;
  reviewRequired?: boolean;
  reviewNotes?: string;
  sections: SeedSection[];
}

const REVIEW_NOTE =
  "Original draft written for Wild Mountain Woodworks. It is NOT legal advice. Review every statement, fill in the bracketed items, and have it checked by a qualified professional before relying on it.";

export const SEED_PAGES: SeedPage[] = [
  {
    slug: "home",
    title: "Homepage",
    seoTitle: "Wild Mountain Woodworks — Handcrafted Furniture Built in Ohio",
    seoDescription: "Handcrafted dining tables, benches, consoles and custom furniture, built one piece at a time in Ohio. Built by hand. Made to belong.",
    sections: [
      {
        key: "hero",
        eyebrow: "Handcrafted Furniture",
        heading: "Furniture made for the life built around it.",
        body: "Handcrafted furniture built one piece at a time in Ohio.",
        image: "hero-room",
        primaryCta: ["Explore Furniture", "/furniture"],
        secondaryCta: ["Start a Custom Build", "/custom-furniture"],
      },
      { key: "categories", eyebrow: "The Collection", heading: "Made for your home.", subheading: "Timeless furniture for the spaces that matter most." },
      {
        key: "featured",
        eyebrow: "Featured",
        heading: "Built to belong.",
        subheading: "Pieces designed for everyday life — and made to be kept for years.",
        primaryCta: ["View All Furniture", "/furniture"],
      },
      {
        key: "custom",
        eyebrow: "Custom Furniture",
        heading: "Your space. Your piece.",
        body: "Every room is different. Choose the dimensions, wood species, finish and details that suit the way you live, and we'll build a piece made specifically for your home.",
        image: "custom-feature",
        primaryCta: ["Start a Custom Build", "/custom-furniture"],
      },
      {
        key: "craftsmanship",
        eyebrow: "Craftsmanship",
        heading: "Real wood. Real craftsmanship.",
        subheading: "What goes into every piece.",
        image: "craft-detail",
        items: [
          { title: "Real Wood", body: "Real wood, chosen board by board for its grain, color and character." },
          { title: "Hand-Built", body: "Each piece is built by hand, one at a time — never on a production line." },
          { title: "Built to Last", body: "Designed to be used every day, and made to stay in the family." },
          { title: "Built in Ohio", body: "Made in our Ohio workshop and prepared for delivery to your home." },
        ],
      },
      {
        key: "work",
        eyebrow: "Our Work",
        heading: "From the workshop.",
        subheading: "A selection of finished pieces, each built for a particular space.",
        primaryCta: ["View Our Work", "/our-work"],
      },
      {
        key: "about",
        eyebrow: "About Wild Mountain",
        heading: "Built in Ohio.",
        body: "Wild Mountain Woodworks is a furniture workshop in Ohio making handcrafted pieces one at a time. Every table, bench and console is built to order, with the time and attention it takes to make something that belongs in a home for years.",
        image: "about-feature",
        primaryCta: ["Our Story", "/about"],
      },
      {
        key: "final-cta",
        eyebrow: "Custom & Quotes",
        heading: "Have something specific in mind? Let's build it.",
        body: "Tell us about the piece you're imagining and we'll follow up personally to talk through the details.",
        image: "cta-grain",
        primaryCta: ["Request a Quote", "/request-quote"],
      },
    ],
  },
  {
    slug: "furniture",
    title: "Furniture",
    seoTitle: "Handcrafted Furniture",
    seoDescription: "Browse handcrafted dining tables, benches, console tables and coffee tables — each built to order and configurable to fit your space.",
    sections: [
      {
        key: "hero",
        eyebrow: "Furniture",
        heading: "The Collection",
        body: "Handcrafted tables, benches and more — each built to order and configurable to fit your space.",
      },
      {
        key: "custom-cta",
        heading: "Don't see exactly what you need?",
        body: "Nearly everything we build can be adjusted — size, wood, finish and details. Or start from scratch with a custom build.",
        primaryCta: ["Start a Custom Build", "/custom-furniture"],
      },
    ],
  },
  {
    slug: "custom-furniture",
    title: "Custom Furniture",
    seoTitle: "Custom Furniture",
    seoDescription: "Custom handcrafted furniture built to your dimensions, wood species, finish and details. Tell us about your piece.",
    sections: [
      {
        key: "hero",
        eyebrow: "Custom Furniture",
        heading: "Your space. Your style. Your piece.",
        body: "Share what you have in mind and we'll work with you on the dimensions, wood, finish and details to build a piece made for your home.",
        image: "custom-hero",
        primaryCta: ["Start Your Custom Build", "#custom-build-form"],
      },
      {
        key: "intro",
        eyebrow: "Made for you",
        heading: "Furniture designed around the way you live.",
        body: "Maybe you need a dining table that seats exactly ten, a console that fits a particular wall, or a bench that matches a table you already love. Custom work starts with your space and your plans for it — and ends with a piece built for them.",
        image: "custom-intro",
      },
      {
        key: "process",
        eyebrow: "The Process",
        heading: "How a custom build works.",
        subheading: "A straightforward process, with a conversation at every step.",
        items: [
          { title: "Tell Us What You're Looking For", body: "Share the piece you have in mind, the room it's for, approximate dimensions and any inspiration photos." },
          { title: "Design & Details", body: "We'll talk through size, wood species, finish and construction details, then send a quote for your approval." },
          { title: "Build", body: "Your piece is built by hand in our Ohio workshop, one step at a time." },
          { title: "Delivery", body: "Once your piece is finished, we'll coordinate delivery to your home." },
        ],
      },
      {
        key: "possibilities",
        eyebrow: "Customization",
        heading: "Make it yours.",
        subheading: "Almost every detail can be tailored.",
        image: "custom-possibilities",
        items: [
          { title: "Dimensions", body: "Length, width and height to fit your room and the way you gather." },
          { title: "Wood species", body: "Pine, oak, maple, walnut and more — each with its own grain and color." },
          { title: "Finish", body: "From natural to deeper tones, chosen to suit your space." },
          { title: "Base style", body: "Trestle, X-base, traditional or modern legs." },
          { title: "Design modifications", body: "Breadboard ends, drawers, edge profiles, matching benches and more." },
        ],
      },
      {
        key: "gallery",
        heading: "In the details",
        items: [
          { title: "Grain", image: "detail-grain" },
          { title: "Edges", image: "detail-edge" },
          { title: "Joinery", image: "detail-joinery" },
        ],
      },
      {
        key: "form",
        eyebrow: "Start your custom build",
        heading: "Tell us about your piece.",
        body: "Rough ideas are welcome — share what you know and we'll follow up personally to fill in the rest.",
      },
    ],
  },
  {
    slug: "our-work",
    title: "Our Work",
    seoTitle: "Our Work",
    seoDescription: "A portfolio of handcrafted furniture from the Wild Mountain Woodworks workshop.",
    sections: [
      { key: "hero", eyebrow: "Our Work", heading: "Pieces from the workshop.", body: "A selection of finished furniture — each one built by hand for a particular space." },
      {
        key: "cta",
        heading: "Have a piece in mind?",
        body: "Any project here can be the starting point for your own.",
        primaryCta: ["Start a Custom Build", "/custom-furniture"],
      },
    ],
  },
  {
    slug: "portfolio-project",
    title: "Portfolio project pages",
    sections: [
      {
        key: "cta",
        eyebrow: "Custom Furniture",
        heading: "Want something similar?",
        body: "Tell us about your space and we'll build a piece made for it.",
        primaryCta: ["Start a Custom Build", "/custom-furniture"],
      },
    ],
  },
  {
    slug: "product",
    title: "Product pages",
    sections: [
      { key: "made-to-order", heading: "Handcrafted to order", body: "Built by hand after you order, to your chosen specifications." },
      {
        key: "wood-note",
        heading: "Natural wood characteristics",
        body: "Every board is different. Grain patterns, knots, color variation and mineral streaks are natural features of real wood, so no two pieces are exactly alike. Wood also moves slightly as humidity changes through the seasons.",
        primaryCta: ["About natural wood", "/wood-characteristics"],
      },
      {
        key: "request",
        heading: "Request this configuration",
        body: "Share your details and we'll follow up with a confirmed quote, lead time and delivery information. No payment is required.",
      },
      {
        key: "cta",
        heading: "Looking for something different?",
        body: "We can adjust nearly any piece — or build something entirely new.",
        primaryCta: ["Start a Custom Build", "/custom-furniture"],
      },
    ],
  },
  {
    slug: "about",
    title: "About",
    seoTitle: "About Wild Mountain Woodworks",
    seoDescription: "Wild Mountain Woodworks builds handcrafted furniture one piece at a time in Ohio.",
    reviewRequired: true,
    reviewNotes: "Add your own story in “The maker” section (currently hidden) and replace workshop photos with real ones. The existing copy avoids any claims about history or experience.",
    sections: [
      { key: "hero", eyebrow: "About", heading: "Wild Mountain Woodworks", body: "Handcrafted furniture, built one piece at a time in Ohio.", image: "about-hero" },
      {
        key: "intro",
        eyebrow: "Built in Ohio",
        heading: "A small workshop making furniture to last.",
        body: "Wild Mountain Woodworks builds furniture by hand in Ohio — dining tables, benches, consoles and custom pieces, each made to order for the home it's going into.\n\nThe goal is simple: furniture that is well proportioned, well made and genuinely useful, in real wood that gets better with age.",
        image: "about-intro",
      },
      {
        key: "why",
        eyebrow: "Why handcrafted",
        heading: "Made differently, on purpose.",
        body: "Furniture built by hand is made slowly and deliberately, with attention to the details that matter over years of daily use.",
        items: [
          { title: "One piece at a time", body: "Each piece gets full attention from the first cut to the final coat of finish." },
          { title: "Made to order", body: "Built to your dimensions and finish rather than pulled from a warehouse." },
          { title: "Real materials", body: "Real wood, chosen for its grain and character." },
        ],
      },
      {
        key: "craftsmanship",
        eyebrow: "Craftsmanship",
        heading: "The details you notice — and the ones you don't.",
        body: "Good furniture comes down to proportion, joinery and finish, and to how a piece feels to use every day. Each step gets the time it needs.",
        image: "about-craft",
      },
      {
        key: "workshop",
        eyebrow: "The Workshop",
        heading: "Where it's made.",
        subheading: "Replace these with photographs of your shop, tools and work in progress.",
        items: [
          { title: "Lumber", image: "workshop-1" },
          { title: "At the bench", image: "workshop-2" },
          { title: "Finishing", image: "detail-grain" },
        ],
      },
      {
        key: "maker",
        visible: false,
        eyebrow: "The Maker",
        heading: "The hands behind the work.",
        body: "Introduce yourself here — who builds each piece, how Wild Mountain started, and what you care about in your work. This section is hidden until you turn it on in Admin → Pages → About.",
      },
      {
        key: "cta",
        heading: "Let's build something together.",
        body: "Browse the collection, or tell us about a custom piece.",
        image: "cta-room",
        primaryCta: ["Explore Furniture", "/furniture"],
        secondaryCta: ["Start a Custom Build", "/custom-furniture"],
      },
    ],
  },
  {
    slug: "faq",
    title: "FAQ",
    seoTitle: "Frequently Asked Questions",
    seoDescription: "Answers to common questions about ordering, custom furniture, materials, finishes, delivery and care.",
    sections: [
      { key: "hero", eyebrow: "FAQ", heading: "Frequently asked questions", body: "Answers to common questions about ordering, custom work, materials, delivery and care." },
      { key: "cta", heading: "Still have questions?", body: "We're happy to help — send us a note.", primaryCta: ["Contact Us", "/contact"] },
    ],
  },
  {
    slug: "contact",
    title: "Contact",
    seoTitle: "Contact",
    seoDescription: "Get in touch with Wild Mountain Woodworks about a piece, a custom project or an existing quote.",
    sections: [
      { key: "hero", eyebrow: "Contact", heading: "Get in touch.", body: "Questions about a piece, a custom project or an existing quote? Send a message and we'll get back to you personally." },
      { key: "details", heading: "Wild Mountain Woodworks", body: "Handcrafted furniture, built in Ohio." },
    ],
  },
  {
    slug: "request-quote",
    title: "Request a Quote",
    seoTitle: "Request a Quote",
    seoDescription: "Request a quote for handcrafted furniture from Wild Mountain Woodworks.",
    sections: [
      {
        key: "hero",
        eyebrow: "Request a Quote",
        heading: "Tell us what you're looking for.",
        body: "Share a few details about the piece you have in mind and we'll follow up with pricing and timing. Looking at a specific piece? You can also configure it on its product page and request that exact configuration.",
      },
      {
        key: "confirmation",
        heading: "Thank you — your request is in.",
        body: "We've received your request and will be in touch soon. Keep your reference number handy in case you need to contact us about it.",
      },
    ],
  },
  // ---------------------------------------------------------------------------
  // Customer care & policy pages (original drafts — require review)
  // ---------------------------------------------------------------------------
  {
    slug: "shipping-delivery",
    title: "Shipping & Delivery",
    seoTitle: "Shipping & Delivery",
    seoDescription: "How delivery works for handcrafted, made-to-order furniture from Wild Mountain Woodworks.",
    reviewRequired: true,
    reviewNotes: `${REVIEW_NOTE} Confirm your delivery area, methods, fees and who is responsible for inspecting freight deliveries.`,
    sections: [{ key: "hero", eyebrow: "Customer Care", heading: "Shipping & Delivery", body: "How we get your finished piece home." }],
    body: `Every Wild Mountain piece is built to order, so delivery is arranged individually once your piece is finished. The details below describe how we approach delivery; your quote will confirm the specifics for your order.

## Lead times

Estimated lead times are shown on each product page and confirmed with your quote. Because each piece is built by hand, lead times depend on the piece, the options chosen and the current workshop schedule. We'll keep you informed if anything changes.

## Delivery area and methods

**[Owner to confirm: describe your delivery area — for example, local delivery within a set distance of the workshop, regional delivery, and whether freight shipping is offered outside that area.]**

Depending on your location, delivery may be made:

- By Wild Mountain directly (local delivery), or
- By a third-party freight or furniture delivery service.

## Delivery fees

**[Owner to confirm: how delivery is priced — included, flat-rate by zone, or quoted per order.]** Any delivery charge will be shown on your quote before you commit.

## Preparing for delivery

Please measure doorways, hallways, stairways and the final room before delivery. Large tables and case pieces need clear paths. If a piece can't safely fit into your home, we'll work with you on options, but additional charges may apply.

## Inspection on arrival

Please inspect your piece carefully at delivery, before signing any delivery receipt.

- If a third-party carrier delivers your order, note any visible damage to packaging or furniture on the delivery receipt and photograph it.
- Contact us within **[Owner to confirm: e.g. 48 hours]** of delivery if you find any damage, so we can make it right.

## Pickup

**[Owner to confirm: whether customers may pick up from the workshop, and how pickup is scheduled.]**`,
  },
  {
    slug: "returns-cancellations",
    title: "Returns & Cancellations",
    seoTitle: "Returns & Cancellations",
    seoDescription: "Our approach to returns, cancellations and order changes for handcrafted, made-to-order furniture.",
    reviewRequired: true,
    reviewNotes: `${REVIEW_NOTE} Decide your change window, cancellation terms, and whether deposits (if introduced) are refundable.`,
    sections: [{ key: "hero", eyebrow: "Customer Care", heading: "Returns & Cancellations", body: "What to know before you order a made-to-order piece." }],
    body: `Because each piece is built specifically for you — often to custom dimensions, in the wood and finish you've chosen — made-to-order furniture works a little differently from store-bought furniture.

## Changes to an order

We're happy to accommodate changes before work begins. Once materials have been prepared or construction has started, changes may not be possible, or may affect the price and lead time. We'll always confirm any change with you in writing before proceeding.

**[Owner to confirm: the point at which an order can no longer be changed — for example, once materials are cut.]**

## Cancellations

- **Before work begins:** orders may be cancelled by contacting us. **[Owner to confirm: whether any fee applies.]**
- **After work begins:** because materials have been cut and labor committed to your piece, cancellations may not be accepted, or may be subject to a charge for work completed and materials used.

## Deposits

**[Owner to confirm, if deposits are introduced: the deposit amount, when it is due, and whether and when it is refundable.]**

## Returns

Standard pieces and custom pieces are made to order and are generally **not returnable**, except as described under our [Furniture Warranty](/warranty) or when an item arrives damaged (see [Shipping & Delivery](/shipping-delivery)).

**[Owner to confirm: whether any return window applies to standard, non-custom pieces, and any restocking or return-delivery fees.]**

## Natural variation is not a defect

Grain, knots, color variation, mineral streaks and seasonal wood movement are natural characteristics of solid wood and are not grounds for a return. Learn more about [natural wood characteristics](/wood-characteristics).

## Questions

If something isn't right with your piece, please [contact us](/contact). We'd much rather fix a problem than leave you unhappy with your furniture.`,
  },
  {
    slug: "warranty",
    title: "Furniture Warranty",
    seoTitle: "Furniture Warranty",
    seoDescription: "Warranty coverage for handcrafted furniture from Wild Mountain Woodworks.",
    reviewRequired: true,
    reviewNotes: `${REVIEW_NOTE} Set the warranty length and confirm exactly what is and isn't covered.`,
    sections: [{ key: "hero", eyebrow: "Customer Care", heading: "Furniture Warranty", body: "Our commitment to the pieces we build." }],
    body: `We build every piece to be used and enjoyed for many years. If a problem arises from how your piece was made, we want to know about it.

## What's covered

**[Owner to confirm: warranty length — e.g. X years from delivery — and whether it applies to the original purchaser only.]**

This warranty covers defects in workmanship and construction under normal household use, such as:

- Joint failure
- Structural defects in the base or frame
- Finish defects that appear under normal use and care

## What isn't covered

- Natural characteristics of wood, including grain, knots, color variation, mineral streaks and changes in color with age and light exposure
- Normal wood movement — small seasonal expansion, contraction or minor checking caused by changes in humidity
- Damage from misuse, accidents, pets, heat, moisture, spills left standing, or improper cleaning products
- Normal wear and tear, including scratches, dents and wear to the finish over time
- Damage from direct sunlight, heating vents, radiators or extreme humidity
- Pieces that have been modified, refinished or repaired by someone else
- Commercial or outdoor use **[Owner to confirm]**

## Making a claim

[Contact us](/contact) with your name, your order or quote reference, a description of the issue and photographs. We'll review it and discuss the best remedy, which may include repair, refinishing or replacement of the affected part at our discretion.

**[Owner to confirm: who covers transportation costs for warranty repairs.]**`,
  },
  {
    slug: "wood-characteristics",
    title: "Wood Characteristics & Natural Variation",
    seoTitle: "Wood Characteristics & Natural Variation",
    seoDescription: "Grain, knots, color variation, mineral streaks and wood movement — what to expect from real wood furniture.",
    reviewRequired: true,
    reviewNotes: "Educational draft. Review for accuracy against the species and finishes you actually use.",
    sections: [{ key: "hero", eyebrow: "Materials", heading: "Wood Characteristics & Natural Variation", body: "Why no two pieces are exactly alike.", image: "detail-grain" }],
    body: `Real wood comes from trees, and every tree is different. The features described here are natural, expected, and part of what makes a handcrafted piece unique. They are not defects.

## Grain

Grain is the pattern created by a tree's growth rings and the way a board is cut. It varies from board to board and even across a single tabletop. Photos on our website show representative pieces — yours will have its own grain.

## Knots

Knots form where branches grew from the trunk. They're especially common in pine. Sound, tight knots are a natural feature; we select and place boards with care, but knots may be present depending on the species and grade of lumber.

## Color variation

Color varies naturally between boards, between species, and within a single board — walnut, for example, can range from pale sapwood to deep chocolate brown. Finishes react differently to each board, so a stained or finished piece will also show some variation.

## Mineral streaks

Mineral streaks are dark streaks or spots caused by minerals the tree absorbed as it grew. They're common in maple and can appear in other species.

## Wood movement

Wood continues to respond to the humidity around it. In humid months it absorbs moisture and expands slightly; in dry months — especially with indoor heating — it releases moisture and contracts. Good furniture construction allows for this movement, but you may notice:

- Slight changes in the width of a tabletop across seasons
- Small gaps at joints or breadboard ends that open and close with the seasons
- Minor seasonal checking (fine surface cracks), especially in very dry conditions

Keeping your home's humidity reasonably steady helps minimize movement.

## Handmade variation

Each piece is built by hand. Small variations in dimensions, edges and details from one piece to another are a natural result of handcraft.

## Color change over time

Wood changes color with exposure to light. Some species darken (cherry, for example), while others lighten or mellow (walnut can lighten over time). Rotate items on your tabletop occasionally to keep the color even.`,
  },
  {
    slug: "furniture-care",
    title: "Furniture Care",
    seoTitle: "Furniture Care",
    seoDescription: "How to care for handcrafted wood furniture so it lasts for years.",
    reviewRequired: true,
    reviewNotes: "Review these care instructions against the finish system you actually use.",
    sections: [{ key: "hero", eyebrow: "Customer Care", heading: "Furniture Care", body: "Simple habits that keep your piece looking its best." }],
    body: `A little everyday care will keep your furniture looking good for years.

## Everyday cleaning

- Dust with a soft, dry, lint-free cloth.
- For spills or sticky spots, wipe with a soft cloth dampened with water (and a drop of mild dish soap if needed), then dry immediately.
- Wipe up spills promptly — don't let liquids stand on the surface.

## What to avoid

- Harsh or abrasive cleaners, ammonia, bleach and silicone-based furniture polishes
- Placing hot dishes, pans or mugs directly on the surface — use trivets and coasters
- Leaving wet glasses or vases directly on the wood
- Cutting directly on the surface
- Dragging heavy or rough objects across the top

## Placement

- Keep furniture out of prolonged direct sunlight, which can fade or change the color of wood and finish.
- Avoid placing pieces directly next to heating vents, radiators, fireplaces or humidifiers.
- Aim for a stable indoor humidity; large swings encourage wood movement.

## Long-term care

**[Owner to confirm: recommended maintenance for your finish — for example, how often to refresh an oil finish, and which products to use.]**

## Scratches and wear

Minor wear is part of a well-used piece's character. For deeper scratches or damage, [contact us](/contact) before attempting a repair — we can advise on the right approach for your finish.`,
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    seoTitle: "Privacy Policy",
    seoDescription: "How Wild Mountain Woodworks collects, uses and protects your information.",
    reviewRequired: true,
    reviewNotes: `${REVIEW_NOTE} Confirm your business legal name and contact details, the email provider and analytics tools (if any) you use, and applicable state privacy laws.`,
    sections: [{ key: "hero", eyebrow: "Legal", heading: "Privacy Policy", body: "How we handle the information you share with us." }],
    body: `**Last updated: [Owner to confirm date]**

This policy explains how **[Owner to confirm: legal business name]** ("Wild Mountain Woodworks", "we", "us") collects and uses information through this website.

## Information we collect

**Information you give us.** When you request a quote, submit a custom build request or contact us, we collect the information you provide — such as your name, email address, phone number, ZIP code, details about the furniture you're interested in, notes, and any reference images you upload.

**Information collected automatically.** Like most websites, our servers record basic technical information such as your IP address, browser type and the pages you request. We use this to operate and secure the site (for example, to prevent spam and abuse).

**[Owner to confirm: whether you use analytics or advertising tools, and name them here.]**

## How we use information

- To respond to your quote, custom build and contact requests
- To prepare quotes and communicate with you about your order
- To operate, maintain and protect our website
- To comply with legal obligations

We do not sell your personal information.

## Payments

We do not currently accept payments on this website. If online payments are introduced, they will be processed by a third-party payment processor on its own secure payment page. We will not store your full card number on our servers.

## Sharing

We share information only with service providers who help us run the business (such as website hosting, email delivery and, if applicable, delivery partners), and only as needed to provide their services, or when required by law.

## Retention

We keep inquiry and order records for as long as needed to serve you and for our business records, then delete or anonymize them. **[Owner to confirm retention period.]**

## Your choices

You may ask us to access, correct or delete your personal information by contacting us. **[Owner/legal to confirm any state-specific rights that apply.]**

## Children

This website is not directed to children under 13, and we do not knowingly collect their information.

## Changes

We may update this policy from time to time. The "last updated" date above shows when it was last changed.

## Contact

Questions about this policy? [Contact us](/contact).`,
  },
  {
    slug: "terms",
    title: "Terms & Conditions",
    seoTitle: "Terms & Conditions",
    seoDescription: "Terms and conditions for using the Wild Mountain Woodworks website and ordering handcrafted furniture.",
    reviewRequired: true,
    reviewNotes: `${REVIEW_NOTE} Confirm legal business name, governing law, and order/payment terms before publishing.`,
    sections: [{ key: "hero", eyebrow: "Legal", heading: "Terms & Conditions", body: "The terms that apply to this website and to our furniture." }],
    body: `**Last updated: [Owner to confirm date]**

These terms apply to your use of this website and to quotes and orders placed with **[Owner to confirm: legal business name]** ("Wild Mountain Woodworks", "we", "us").

## Quotes and estimates

Prices and estimates shown on this website, including configured prices, are provided for guidance. **A quote is not an order.** Your final price, specifications, lead time and delivery details are confirmed in a written quote from us. Quotes are valid for **[Owner to confirm: e.g. 30 days]** unless stated otherwise.

## Orders

An order is confirmed only when we accept it in writing **[Owner to confirm: and any required deposit or payment is received]**. We reserve the right to decline any order.

## Made-to-order and custom furniture

Our furniture is built to order. Custom dimensions, finishes and modifications are built to the specifications you approve. Please review your quote carefully — see [Returns & Cancellations](/returns-cancellations) for how changes and cancellations work.

## Natural materials

Our furniture is made from natural wood. Variation in grain, color, knots and mineral streaks, and normal seasonal wood movement, are characteristics of the material and not defects. See [Wood Characteristics](/wood-characteristics).

## Product images and descriptions

We try to show our furniture accurately, but photographs are representative. Colors vary between screens, and every piece of wood is unique.

## Delivery

Delivery terms are described on our [Shipping & Delivery](/shipping-delivery) page and confirmed in your quote.

## Warranty

Our warranty is described on the [Furniture Warranty](/warranty) page.

## Website use

The content of this website — including text, photographs, logos and designs — belongs to Wild Mountain Woodworks and may not be copied or used without permission.

## Limitation of liability

**[Legal to draft: limitation of liability appropriate to your business and state.]**

## Governing law

These terms are governed by the laws of the State of **[Owner to confirm: Ohio]**.

## Contact

Questions about these terms? [Contact us](/contact).`,
  },
];
