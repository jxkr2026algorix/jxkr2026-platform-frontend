# SALGIL Wireframe Design Contract

## 0. Research Log

- Product source: the supplied Gyeongbuk disaster-evacuation planning document. Its operating loop applies to flood, wildfire, landslide, earthquake, industrial accident, road failure, and compound incidents: assess, approve, contact, dispatch, report, replan, and review.
- Product reference: the actual Furikake repository at `/Users/hyunmyung.joo/projects/furikake`. Its `tokens.css`, workspace CSS, design-token notes, and desktop/mobile dashboard captures establish the visual contract: `#171719` ink, cool white/gray surfaces, low-contrast lines, a restrained cobalt action color, Pretendard-family typography, and row-led grouping instead of default card grids.
- Brand direction: Wanted is the primary tonal reference and Toss remains a secondary usability reference. Current Wanted product and recruiting surfaces were reviewed on Aug 22, 2026: strong editorial typography, near-white pages, `#36f`-family actions, narrow 6–10px radii, and list-led grouping. SALGIL adopts that grammar without copying brand assets, content, or proprietary components.
- Anti-pattern review: the installed `kill-ai-slop` taxonomy. This prototype intentionally avoids gradients, glass, decorative emoji, excessive pills, tinted icon tiles, nested cards, invented statistics, and dramatic marketing copy.
- Spatial reference: Palantir Gotham is an information-architecture reference only. SALGIL adopts its map-first operating model—layer control, selected-object inspection, and route/incident overlays—without copying proprietary branding, assets, or interface chrome.
- Map implementation: the production console embeds `@salgil/map-webgpu-canvas` as a full-size iframe and communicates only through the versioned `postMessage` protocol. Scenario, rainfall, view mode, simulation state, overlay visibility, and camera focus remain dashboard-owned controls; renderer state and failures are reflected back in text so the map is never the only source of operational truth.
- Visual research sources: the current Wanted recruiting surface (`recruit.wanted.co.kr`), Wanted recruiting-service pages, and published Wanted Design System interface examples. The implementation harvests surface, type, radius, navigation, and row anatomy only; SALGIL remains an operational product rather than a recruitment-site clone.
- Full-map shell reference: the user-supplied Google travel-planning concept. SALGIL adopts its full-bleed map canvas, detached translucent control surfaces, and centered horizontal navigation grammar, while keeping SALGIL's own operational content, blue-neutral tokens, and restrained density.

## 1. Atmosphere & Identity

SALGIL is calm, clear, and action-first. It lowers fear, favors immediate comprehension over decoration, and turns every active incident into one legible next action. The real map is the primary working plane, supported by a checklist and concise status surfaces. Blue establishes trust and structure; green confirms safety; orange communicates a warning; red is reserved for immediate danger or an emergency call.

The desktop product is a municipal command workspace. The field product is a plain mobile utility for residents and patrol staff. Both use the same language and status model but are separate frontend surfaces.

The floating console chrome follows an Apple Liquid Glass direction: neutral, lens-like layers with varied transmission, crisp inner highlights, and compact capsule controls. The map supplies the color and visual drama. Blue is no longer the structural color of panels or selected navigation; it is reserved for the SALGIL mark, focus, and the few actions that truly need platform emphasis.

## 2. Color Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--canvas` | `#ffffff` | App background |
| `--surface` | `#ffffff` | Primary working surface |
| `--surface-subtle` | `#f7f8fa` | Quiet grouping surface |
| `--surface-raised` | `#f7f8fa` | Map and secondary data plane |
| `--ink` | `#171719` | Primary text |
| `--ink-subtle` | `#5c6068` | Body and metadata |
| `--ink-muted` | `#8a8f98` | Metadata and tertiary labels |
| `--line` | `#e5e7eb` | Necessary row and shell dividers only |
| `--line-strong` | `#d1d5db` | Form control boundary |
| `--primary` | `#3366ff` | Brand structure and navigation |
| `--action` | `#3366ff` | Primary action, focus, current selection |
| `--action-hover` | `#2957e8` | Primary button hover |
| `--primary-soft` | `#f2f5ff` | Selected row or route support only |
| `--safe` | `#22c55e` | Confirmed safety and open route |
| `--safe-soft` | `#f0fdf4` | Safety support surface |
| `--safe-ink` | `#166534` | Accessible safe-state text |
| `--alert` | `#f97316` | Warning that requires attention |
| `--alert-soft` | `#fff7ed` | Warning support surface |
| `--alert-ink` | `#c2410c` | Accessible warning text |
| `--on-primary` | `#ffffff` | Text on a primary action |
| `--critical` | `#ef4444` | SOS, Call 119, and immediate danger only |
| `--critical-soft` | `#fef2f2` | Urgent feedback support surface |
| `--critical-ink` | `#b91c1c` | Critical feedback text |

Floating-shell additions use near-black `#1d1d1f`, secondary neutral `#6e6e73`, and three glass transmission levels: 72% for navigation, 82% for compact tools, and 88% for dense operational reading. Each level uses a white inner rim and no diffuse exterior shadow.

Status is communicated with text and structure, not color alone. Cobalt is not used as a general surface tint, and semantic colors never become a category rainbow.

## 3. Typography

- Stack: `Pretendard GOV Variable`, `Pretendard GOV`, Apple system UI, and Korean-capable sans-serif fallbacks. The portable prototype also loads the official Pretendard GOV webfont stylesheet.
- Display: 32px / 42px / 700.
- Page title: 24px / 32px / 650.
- Section title: 17px / 24px / 650.
- Body: 15px / 22px / 450. Dense desktop operations metadata may use 13px but never smaller for an action.
- Caption: 13px / 18px / 500.
- Button: 14px / 18px / 600.
- Labels use sentence case in Korean. All-caps labels and editorial serif treatments are excluded.

## 4. Spacing & Layout

- Base spacing unit: 8px, with 4px and 12px half-steps where density requires them.
- Control gaps: 8px; row padding: 12–16px; section gaps: 24–32px.
- Desktop shell: one full-bleed map fixed to `100dvh`. The map is mounted outside route content and persists across navigation. Product identity sits at the upper-left, incident/map status at the upper-right, and page navigation in a centered bottom dock.
- Map workspace: the renderer owns the entire viewport. Situation controls float at the left, selected-object inspection floats at the right, and recent events occupy one compact bottom rail above the navigation dock.
- Map scroll ownership: the application shell is fixed to `100dvh`; the map never scrolls. Layer and inspector rails own independent vertical scroll only when their content exceeds the viewport.
- Compact operations layout: below 1040px, the map remains first and full-width; layer controls become a horizontal toolbar and the inspector moves below the map. Below 760px, operational rails stack as document sections while the map retains at least 420px height.
- Mobile field surface: full document scroll, 20px inset, 20–24px section padding, 60px minimum list rows, and a 52px primary action.
- Responsive breakpoints: 700px, 900px, and 1100px. Comparison tables retain headers with compact wrapping from 701–900px and collapse into labelled rows at 700px and below.
- Scroll ownership: the desktop main region owns vertical scroll. A map/list split may give the village list one bounded scroll owner. The field app uses document scroll only.

## 5. Components

### App shell

- Structure: persistent full-screen map, detached product mark, detached incident context, bottom-centered route dock, and one route content layer.
- States: default, current navigation item, compact mobile navigation.
- Accessibility: navigation has an explicit label and current item uses `aria-current`.
- Layout owner: the shell never scrolls. Situation overlays own bounded local scrolling; non-map routes use one centered floating work sheet as their sole scroll owner.

### Button

- Variants: primary, secondary, text, critical.
- Height: 40px desktop, 52px field.
- Radius: all push buttons use a full pill radius. Compact square utility controls remain circular. Data surfaces retain a restrained 10px radius so the interface does not become a field of bubbles.
- States: hover via small background or border change; focus ring; disabled opacity and cursor.
- Motion: 110–140ms ease-out feedback. A press may compress to `0.975` and recover immediately; no bounce, elastic overshoot, or `transition: all`.

### Segmented control

- Structure: flat tab row with one bottom divider and no filled track.
- Selected state: primary text with a 2px underline. No shadow or selected card.
- Accessibility: implemented as buttons with `aria-pressed`.
- Hierarchy rule: only route or content-state navigation may use the full-width underlined row. A secondary context switch such as `Resident / Field team` is a compact, right-aligned control with a quiet selected fill and no divider, so two tab bars never stack.
- The content immediately following a tab row must not add another top divider. The tab row owns that boundary.

### Data surface

- Structure: one tonal region with header, rows, and optional footer. A boundary is added only when a data grid genuinely needs an outside edge.
- Operations data pages use a white table shell and white body rows on the cool canvas. Table headers alone use `--surface-raised`; `--surface-subtle` is reserved for inactive controls and must not flood an entire roster.
- Summary metrics share one white band with quiet dividers. Their values use `--primary` for brand continuity rather than adding category colors.
- Radius: 10px for the few real grouping surfaces. Status summaries may instead use square horizontal rules with no enclosing radius. Nested rows have no independent radius or shadow.
- States: selected rows use `--primary-soft` and primary text, without a decorative leading border.
- Accessibility: table markup where comparison matters; buttons for interactive rows.

### Quick action list

- Quick actions are one continuous white list with row dividers, not a 2×2 grid of rounded icon cards.
- Each row leads with a specific action label and ends with one short consequence or destination. Decorative icons and tinted icon containers are excluded.

### Status label

- Structure: plain text preceded by a small square marker where useful.
- Variants: neutral, active, approved, critical.
- No pill container except incident mode, where the compact boundary communicates a mode switch.
- Accessibility: visible text always names the state.

### Spatial operations workspace

- Structure: real interactive basemap, two dense floating control groups, map command bar, selected-object inspector, and operational timeline.
- Floating controls: simulation and community-priority controls live inside the map at the upper-left. Compact tool glass uses 80–84% white, 24px blur, a white inner highlight, and a 16px continuous radius. Blur is functional separation over moving terrain, not a translucent copy of the former side rail.
- Route dock: four routes appear in a compact centered horizontal row near the lower safe area. The dock uses the most transmissive glass level; the active route uses a small 88% white inner lens and near-black text. Inactive routes remain neutral gray, never blue.
- Floating work sheets: plan, contact, and field-task routes retain the live map behind a centered, bounded 82–86% white reading lens. The sheet owns its vertical scroll and leaves map context visible around its edges. Existing table boxes are flattened so the lens, not an old page container, owns the visual hierarchy.
- Map plane: the WebGPU terrain and hazard simulation is visually primary. It is isolated in an iframe; dashboard chrome never overlays renderer controls except for explicit loading, failure, and route-revision states.
- Overlay groups: communities, multi-hazard exposure, evacuation routes, access constraints, shelters, and field teams. Every group has a labelled checkbox and a numeric count.
- Map objects: compact square or diamond markers with persistent short labels. Selected communities use a cobalt outline and remain paired with a textual inspector.
- Hazard areas: translucent geometry plus a named legend item; never color alone. Routes use safe green when open, action blue when selected, and dashed critical red only for a blocked segment.
- Inspector: selected community, operational state, affected residents, primary hazard, assigned shelter, transport, last update, and one next action.
- Timeline: latest four decision events in time order. It uses one structural divider and no individual cards.
- Motion: map pan/zoom and immediate overlay visibility only. Route changes update the map and written explanation together.
- Fallback: if online tiles are unavailable, the map region states that the basemap is unavailable while retaining overlay controls and the textual community list.

### Empty and feedback state

- Structure: concise title, one explanatory sentence, one optional action.
- Placement: inside the content region that owns the missing data.
- Feedback: updates use `aria-live="polite"`; destructive or urgent notices use `role="alert"`.

## 6. Motion & Interaction

- Route navigation uses React Router and retains the shared shell. Route content crossfades by 4px over 130ms; reduced-motion preferences make the transition immediate.
- Sidebar navigation stays neutral: inactive labels use muted neutral ink and the current route uses primary ink weight only, with no brand-tinted background.
- Navigation, buttons, and compact map controls compress to `0.975` for roughly 100ms while pressed. Selection and disclosure transitions are limited to 110–160ms opacity, transform, or background color.
- Plan approval, contact completion, and field reporting update persistent state within the session and announce the change.
- Reduced-motion preferences remove nonessential transitions.
- Keyboard order follows visual order. No hover-only information exists.

### Resident demo states

- **Normal:** “You’re safe for now,” one safety-check action, 72% preparedness, four quick actions, and family/contact states.
- **Alert:** one orange warning and one directive, “Move to higher ground now.” The dominant action reveals a safe route; Call 119 is the only red control.
- **Route:** a green route, nearest safe shelter, travel time, ordered checklist, and a single evacuation progress action.
- The demo mode switch exposes all three states for judging, but the content itself remains usable without understanding the switch.

## 7. Depth & Surface

- White canvas, spacing, type weight, and selected-state blue provide the hierarchy.
- The operations map, plan, contact roster, and field-task pages share the same surface ladder: white page → quiet neutral header/toolbar → blue selected/action state.
- Most regions have no outer border. Low-contrast lines are reserved for app-shell boundaries, table rows, and form fields.
- Tabs and selected navigation use color, weight, and an underline or quiet tint; shadows are excluded.
- Resident status surfaces use a neutral white surface and one quiet border. Safety or warning color belongs to the status label, not simultaneously to border, background, and text.
- Diffuse card shadows are excluded. The only retained shadow is the tight selected-segment shadow because it communicates control state.
- Panels never contain independent card grids. Summary values share one quiet band without individual boxes.
- Full-map floating surfaces may use the requested backdrop blur and a tight 1px white/neutral rim. They do not use diffuse drop shadows, glow, colored glass, or multiple nested translucent layers.

## 8. Accessibility Constraints & Accepted Debt

- Target contrast is WCAG AA for text and controls.
- Focus is visible on every interactive element.
- Touch targets are at least 44px on the field app.
- Maps are duplicated by the layer rail, inspector, route summary, and timeline so map interpretation is never the only path to information.
- Accepted prototype debt: operational geometry and coordinates are static scenario data; there is no authentication, backend, telephony, routing engine, live sensor ingestion, or cross-device synchronization. The iframe URL is supplied through `VITE_MAP_URL`; production deployment must configure its final map origin explicitly.
- Accepted responsive debt: the operations workspace becomes a simplified stacked view on narrow screens; it is not intended to replace the field app.
