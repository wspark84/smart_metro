# Design System Strategy: The Vigilant Pulse

## 1. Overview & Creative North Star
This design system is anchored by a Creative North Star we call **"The Vigilant Pulse."** 

In the chaotic, high-friction environment of a morning commute, users don’t need a spreadsheet; they need a sophisticated instrument that breathes with them. This system rejects the "standard utility" look in favor of a **High-End Editorial** aesthetic. We achieve this through intentional asymmetry, dramatic typographic scale, and a "spatial narrative" where information isn't just displayed—it is staged.

By moving away from rigid grids and 1px borders, we create a fluid, premium experience that feels less like a "tool" and more like a high-performance concierge. We use depth and tonal shifts to guide the eye, ensuring that even in a pre-coffee rush, the user’s next move is instinctual.

---

## 2. Color & Chromatic Narrative
We utilize a palette that balances deep, authoritative trust with high-visibility urgency.

### The "No-Line" Rule
To maintain a premium, editorial feel, **1px solid borders are strictly prohibited for sectioning.** Boundaries must be defined solely through background color shifts. For example, a card using `surface_container_lowest` should sit atop a `surface_container_low` background. This creates a soft, sophisticated transition that feels architectural rather than "boxed in."

### Surface Hierarchy & Nesting
Treat the UI as a series of layered physical materials—like stacked sheets of fine vellum.
*   **Base:** `surface` (#f7f9fc)
*   **Subtle Grouping:** `surface_container_low` (#f2f4f7)
*   **Interactive Cards:** `surface_container_lowest` (#ffffff)
*   **Elevated Alerts:** `surface_container_highest` (#e0e3e6)

### The "Glass & Gradient" Rule
To break the monotony of flat UI:
*   **Glassmorphism:** For floating action buttons or critical alert overlays, use `on_surface` with a 10% opacity and a 20px backdrop-blur. 
*   **Signature Textures:** Main CTAs should never be flat. Use a subtle linear gradient from `primary` (#003178) to `primary_container` (#0d47a1) at a 135-degree angle to give the element "soul" and weight.

---

## 3. Typography
Our typography is a dialogue between the geometric authority of **Manrope** and the functional precision of **Inter**.

*   **Display & Headlines (Manrope):** These are our "Editorial Hooks." Use `display-lg` and `headline-md` with tight letter-spacing (-0.02em) to create a bold, confident presence. This is where the brand’s "Trustworthy" personality lives.
*   **Body & Labels (Inter):** Reserved for data and instruction. Inter provides maximum legibility at high speeds. 
*   **The Scale:** We utilize extreme contrast in size. A `display-sm` arrival time paired with a `label-sm` secondary caption creates a clear information hierarchy that can be read at arm's length while running for a bus.

---

## 4. Elevation & Depth
In this system, depth is a functional tool for "Alert-Focused" design.

*   **The Layering Principle:** Avoid drop shadows for standard organization. Instead, "stack" tiers. Place a `surface_container_lowest` card on a `surface_container_low` section to create a soft, natural lift.
*   **Ambient Shadows:** When an element must "float" (like a critical lateness alert), use an ambient shadow: `y: 8px, blur: 24px, color: rgba(25, 28, 30, 0.06)`. This mimics natural light rather than digital "glow."
*   **The "Ghost Border":** If accessibility requires a container edge, use the `outline_variant` token at **15% opacity**. This provides a "suggestion" of a container without breaking the "No-Line" rule.

---

## 5. Components

### Buttons (High-Impact Interaction)
*   **Primary:** Rounded-xl (`1.5rem`), using the Primary-to-Primary-Container gradient. Text is `on_primary` (#ffffff).
*   **Tertiary/Ghost:** No container. Use `primary` (#003178) text with `label-md` weight.

### Risk Status Cards (The Pulse)
Forbid standard thin-stroke icons. Use full-bleed tonal shifts:
*   **Critical (Red):** Use `tertiary_container` (#902300) with `on_tertiary_container` text.
*   **Warning (Yellow/Orange):** Use custom-tinted glass surfaces.
*   **Layout:** Use asymmetrical padding (e.g., `pl-6, pr-4`) to create a modern, non-standard rhythm.

### Inputs & Fields
*   **Surface:** Use `surface_container_highest`. 
*   **Focus State:** Shift background to `primary_fixed` (#d9e2ff) rather than adding a thick border.
*   **Touch Targets:** All interactive elements must maintain a minimum height of `48px` to accommodate users in a rush.

### Lists (No-Divider Strategy)
**Forbid the use of divider lines.** Separate list items using `8px` or `12px` of vertical white space from the Spacing Scale. Use `surface_container_low` as a subtle background for alternating items if visual separation is struggling.

### Dedicated Component: The "Time-to-Door" Gauge
A large-scale custom component using a `secondary` (#006a62) semi-circle progress bar with `display-lg` typography in the center. This acts as the "hero" of the dashboard.

---

## 6. Do’s and Don’ts

### Do:
*   **Use Asymmetry:** Place the most critical status (e.g., "6 min late") slightly off-center or significantly larger to draw immediate focus.
*   **Embrace White Space:** Let the `surface` breathe. High-end design is defined by what you *don't* put on the screen.
*   **Color as Meaning:** Use `tertiary` (#681700) only when the user needs to take immediate action.

### Don’t:
*   **Don't use 1px Dividers:** They clutter the UI and make it look like a legacy system.
*   **Don't use Pure Black Shadows:** They look "muddy." Always tint shadows with a hint of the `on_surface` color.
*   **Don't use Center-Alignment for everything:** It feels static. Use left-aligned headlines with right-aligned status chips to create "Visual Tension" that feels modern.