# SALGIL Wireframe Design Contract

## 0. Research Log

- Product source: the supplied Gyeongbuk disaster-evacuation planning document. Its operating loop applies to flood, wildfire, landslide, earthquake, industrial accident, road failure, and compound incidents: assess, approve, contact, dispatch, report, replan, and review.
- Product reference: the actual Furikake repository at `/Users/hyunmyung.joo/projects/furikake`. Its `tokens.css`, workspace CSS, design-token notes, and desktop/mobile dashboard captures establish the visual contract: `#171719` ink, cool white/gray surfaces, low-contrast lines, a restrained cobalt action color, Pretendard-family typography, and row-led grouping instead of default card grids.
- Brand direction: Wanted is the primary tonal reference and Toss remains a secondary usability reference. Current Wanted product and recruiting surfaces were reviewed on Aug 22, 2026: strong editorial typography, near-white pages, `#36f`-family actions, narrow 6–10px radii, and list-led grouping. SALGIL adopts that grammar without copying brand assets, content, or proprietary components.
- Anti-pattern review: the installed `kill-ai-slop` taxonomy. This prototype intentionally avoids gradients, decorative emoji, excessive pills, tinted icon tiles, nested cards, invented statistics, and dramatic marketing copy. Liquid Glass is the deliberate material language requested for map-native operational controls, so blur and transmission provide functional separation rather than decoration.
- Spatial reference: Palantir Gotham is an information-architecture reference only. SALGIL adopts its map-first operating model—layer control, selected-object inspection, and route/incident overlays—without copying proprietary branding, assets, or interface chrome.
- Map implementation: the production console embeds `@salgil/map-webgpu-canvas` as a full-size iframe and communicates only through the versioned `postMessage` protocol. Scenario, rainfall, view mode, simulation state, overlay visibility, and camera focus remain dashboard-owned controls; renderer state and failures are reflected back in text so the map is never the only source of operational truth.
- Visual research sources: the current Wanted recruiting surface (`recruit.wanted.co.kr`), Wanted recruiting-service pages, and published Wanted Design System interface examples. The implementation harvests surface, type, radius, navigation, and row anatomy only; SALGIL remains an operational product rather than a recruitment-site clone.
- Full-map shell reference: the user-supplied Google travel-planning concept. SALGIL adopts its full-bleed map canvas, detached translucent control surfaces, and centered horizontal navigation grammar, while keeping SALGIL's own operational content, blue-neutral tokens, and restrained density.

## 1. Atmosphere & Identity

SALGIL is calm, clear, and action-first. It lowers fear, favors immediate comprehension over decoration, and turns every active incident into one legible next action. The real map is the primary working plane, supported by a checklist and concise status surfaces. Blue establishes trust and structure; green confirms safety; orange communicates a warning; red is reserved for immediate danger or an emergency call.

The desktop product is a municipal command workspace. The field product is a plain mobile utility for residents and patrol staff. Both use the same language and status model but are separate frontend surfaces.

The console uses a restrained floating-blur direction rather than Liquid Glass. Two stable frosted work panels frame the live map, with quiet neutral fills, a single soft shadow, and no refractive rims or stacked translucent cards. The map supplies the color and visual drama. Blue is reserved for the SALGIL mark, focus, and the few actions that truly need platform emphasis.

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

Floating-shell additions use near-black `#1d1d1f`, secondary neutral `#6e6e73`, and three practical surface levels: 82% for the route dock, 88% for map controls, and 94% for dense operational reading. Every floating surface uses the same 18px backdrop blur, one quiet border, and one restrained shadow. Inner highlights, refraction effects, and nested translucent containers are excluded.

Status is communicated with text and structure, not color alone. Cobalt is not used as a general surface tint, and semantic colors never become a category rainbow.

## 3. Typography

- Stack: `Pretendard GOV Variable`, `Pretendard GOV`, Apple system UI, and Korean-capable sans-serif fallbacks. The portable prototype also loads the official Pretendard GOV webfont stylesheet.
- Display: 32px / 42px / 700.
- Page title: 24px / 32px / 650.
- Section title: 17px / 24px / 650.
- Body: 15px / 22px / 450. Dense desktop operations metadata may use 13px but never smaller for an action.
- Caption: 13px / 18px / 500.
- Button: 14px / 18px / 600.
- Labels use English sentence case. All-caps labels and editorial serif treatments are excluded.

## 4. Spacing & Layout

- Base spacing unit: 8px, with 4px and 12px half-steps where density requires them.
- Control gaps: 8px; row padding: 12–16px; section gaps: 24–32px.
- Desktop shell: one full-bleed map fixed to `100dvh`. The map is mounted outside route content and persists across navigation. Product identity sits at the upper-left, incident/map status at the upper-right, and page navigation in a centered bottom dock.
- Map workspace: the renderer owns the entire viewport. Situation controls float at the left, selected-object inspection floats at the right, and recent events occupy one centered bottom rail capped at 680px above the navigation dock.
- Map scroll ownership: the application shell is fixed to `100dvh`; the map never scrolls. Layer and inspector rails own independent vertical scroll only when their content exceeds the viewport.
- Console scope: desktop operations only, verified at 1280×800 and 1440×900. Narrow-screen console behavior is not part of the acceptance surface; resident and field workflows belong to `apps/mobile`.
- Desktop adaptation: the selected-object inspector may collapse below 1100px, but the full-screen map, operational controls, and centered route dock remain the console structure.
- Scroll ownership: the desktop main region owns vertical scroll. A map/list split may give the village list one bounded scroll owner. The field app uses document scroll only.

## 5. Components

### App shell

- Structure: persistent full-screen map, detached product mark, detached incident context, bottom-centered route dock, and one route content layer.
- States: default and current navigation item.
- Accessibility: navigation has an explicit label and current item uses `aria-current`.
- Layout owner: the shell never scrolls. Situation overlays own bounded local scrolling; non-map routes use one centered floating work sheet as their sole scroll owner.

### Button

- Variants: primary, secondary, text, critical.
- Height: 40px desktop, 52px field.
- Radius: all push buttons use a full pill radius. Compact square utility controls remain circular. Data surfaces retain a restrained 10px radius so the interface does not become a field of bubbles.
- States: hover via small background or border change; focus ring; disabled opacity and cursor.
- Motion: 110–140ms ease-out feedback. A press may compress to `0.975` and recover immediately; no bounce, elastic overshoot, or `transition: all`.

### Segmented control

- Structure: route tabs use a flat row; compact map controls pair a labeled three-segment camera track with a labeled two-segment basemap track so neither surface spreads behind its label.
- Selected state: compact modes use one quiet inset surface and tight shadow; inactive items remain transparent.
- Accessibility: implemented as buttons with `aria-pressed`.
- Hierarchy rule: only route or content-state navigation may use the full-width underlined row. A secondary context switch such as `Resident / Field team` is a compact, right-aligned control with a quiet selected fill and no divider, so two tab bars never stack.
- The content immediately following a tab row must not add another top divider. The tab row owns that boundary.

### Floating select

- The trigger is a 40px neutral control with a 10px radius, inset chevron, and enough right padding that the icon never touches the edge.
- The option popover is custom-rendered, keyboard navigable, and anchored within the owning panel. It opens with a 120ms opacity/translate transition and never uses bounce or a morphing glass effect.
- The selected option uses a low-contrast neutral fill, a checkmark, and stronger text. Hover, focus, and selected states remain distinct without brand-colored fills.

### Checkbox

- Native checkbox semantics remain in the DOM. A 16px square neutral control and explicit checkmark provide the visible state.
- Focus is shown around the control, not the entire row. The label and count remain separately readable.

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

- Structure: real interactive basemap, one consolidated left operations panel, one right selected-object inspector, and one compact operational timeline.
- Floating controls: the incident heading, simulation controls, and community priority list share the left panel instead of overlapping as separate surfaces. The panel uses an 88% neutral fill, 18px blur, one quiet border, and a 14px radius.
- Route dock: four routes appear in a compact centered horizontal row near the lower safe area. The dock uses an 82% neutral blurred surface; the active route uses a quiet neutral inset fill and near-black text. Inactive routes remain neutral gray, never blue.
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
- Map control values, including camera and basemap selection, update optimistically in the console. Continuous rainfall input is coalesced to one renderer command per animation frame so the thumb and numeric label never wait for iframe state acknowledgement.
- Plan approval, contact completion, and field reporting update persistent state within the session and announce the change.
- Reduced-motion preferences remove nonessential transitions.
- Keyboard order follows visual order. No hover-only information exists.

### Resident demo states

- **Normal:** “You’re safe for now,” one safety-check action, 72% preparedness, four quick actions, and family/contact states.
- **Alert:** one orange warning and one directive, “Move to higher ground now.” The dominant action reveals a safe route; Call 119 is the only red control.
- **Route:** a green route, nearest safe shelter, travel time, ordered checklist, and a single evacuation progress action.
- The demo mode switch exposes all three states for judging, but the content itself remains usable without understanding the switch.

## 7. Depth & Surface

- The live map, spacing, type weight, and neutral selected states provide the hierarchy.
- The operations map, plan, contact roster, and field-task pages share the same surface ladder: map canvas → quiet floating blur → high-opacity reading surface.
- Most regions have no outer border. Low-contrast lines are reserved for app-shell boundaries, table rows, and form fields.
- Tabs and selected navigation use color, weight, and an underline or quiet tint; shadows are excluded.
- Resident status surfaces use a neutral white surface and one quiet border. Safety or warning color belongs to the status label, not simultaneously to border, background, and text.
- Diffuse card shadows are excluded. The only retained shadow is the tight selected-segment shadow because it communicates control state.
- Panels never contain independent card grids. Summary values share one quiet band without individual boxes.
- Full-map floating surfaces use one quiet border, 18px backdrop blur, and one restrained shadow. They do not use refractive rims, glow, colored glass, or nested translucent containers.

## 8. Accessibility Constraints & Accepted Debt

- Target contrast is WCAG AA for text and controls.
- Focus is visible on every interactive element.
- Touch targets are at least 44px on the field app.
- Maps are duplicated by the layer rail, inspector, route summary, and timeline so map interpretation is never the only path to information.
- Accepted prototype debt: operational geometry and coordinates are static scenario data; there is no authentication, backend, telephony, routing engine, live sensor ingestion, or cross-device synchronization. The iframe URL is supplied through `VITE_MAP_URL`; production deployment must configure its final map origin explicitly.
- Accepted responsive debt: `console-front` intentionally targets desktop command workstations. Narrow-screen resident and patrol use cases are owned by `apps/mobile` rather than a compressed console.
