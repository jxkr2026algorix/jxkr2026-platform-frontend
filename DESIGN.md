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
| `--overlay-scrim` | `rgb(23 23 25 / 44%)` | Mobile permission gate backdrop; solid dimming without blur |
| `--control-shadow` | `0 1px 2px rgb(23 23 25 / 10%)` | Tight elevation for detached map controls and annotations |
| `--overlay-shadow` | `0 8px 24px rgb(23 23 25 / 16%)` | Mobile permission dialog elevation |

The console sidebar theme adds one graphite material family without changing
the map canvas: `--sidebar-dark-surface`, `--sidebar-dark-surface-strong`,
`--sidebar-dark-ink`, `--sidebar-dark-ink-secondary`,
`--sidebar-dark-ink-tertiary`, `--sidebar-dark-line`, and
`--sidebar-dark-control`. These tokens are scoped to the left operations rail,
right district rail, and the assistant drawer that replaces the right rail.
They must never cascade into the map renderer or its zoom controls.

Floating-shell additions use near-black `#1d1d1f`, secondary neutral `#6e6e73`, and three practical surface levels: 82% for the route dock, 80–86% for the sidebar glass, and 88% for compact map controls. Both light and dark floating rails use the same 24px backdrop blur and one restrained shadow so softened map color remains perceptible through the material; outer borders are omitted when the surface fill already separates them from the map. Inner highlights, refraction effects, and nested translucent containers are excluded.

Status is communicated with text and structure, not color alone. Cobalt is not used as a general surface tint, and semantic colors never become a category rainbow.

## 3. Typography

- Stack: `Pretendard GOV Variable`, `Pretendard GOV`, Apple system UI, and Korean-capable sans-serif fallbacks. The portable prototype also loads the official Pretendard GOV webfont stylesheet.
- Display: 32px / 42px / 700.
- Page title: 24px / 32px / 650.
- Section title: 17px / 24px / 650.
- Body: 15px / 22px / 450. Dense desktop operations metadata may use 13px but never smaller for an action.
- Caption: 13px / 18px / 500.
- Button: 14px / 18px / 500.
- Labels use English sentence case. All-caps labels and editorial serif treatments are excluded.

## 4. Spacing & Layout

- Base spacing unit: 8px, with 4px and 12px half-steps where density requires them.
- Control gaps: 8px; row padding: 12–16px; section gaps: 24–32px.
- Desktop shell: one full-bleed map fixed to `100dvh`. Full-height floating left and right rails frame the renderer with the existing 16px safe-area inset, blur, radius, and shadow. Product identity and event controls begin directly below one compact header row in the left rail; the mobile QR occupies the lower-left safe area. District context occupies the right rail. Mobile is a separate client and is entered only through the QR code.
- Map workspace: the renderer owns the entire viewport. Event, map-view, basemap, and a compact district selector share one left rail. The right rail is reserved for the selected district's weather snapshot, platform-alert summary, and a compact three-item recent-event timeline. Static district lists, community priority, and selected-community inspection remain absent.
- Map scroll ownership: the application shell is fixed to `100dvh`; the map never scrolls. The left operations rail owns vertical scroll only when its content exceeds the viewport.
- Console scope: desktop operations only, verified at 1280×800 and 1440×900. Narrow-screen console behavior is not part of the acceptance surface; resident and field workflows belong to `apps/mobile`.
- Desktop adaptation: the full-screen map, operational controls, and centered shortcut dock remain the console structure.
- Scroll ownership: the desktop main region owns vertical scroll. A map/list split may give the village list one bounded scroll owner. The field app uses document scroll only.

## 5. Components

### App shell

- Structure: persistent full-screen map, full-height left and right rails, and one route content layer. The situation route has no bottom status dock or decorative connection indicator; mode remains visible only where it controls event creation.
- States: default and current navigation item.
- Accessibility: navigation has an explicit label and current item uses `aria-current`.
- Layout owner: the shell never scrolls. Situation overlays own bounded local scrolling; non-map routes use one centered floating work sheet as their sole scroll owner.

### Brand collaboration header

- The console-only header places the locale-specific SALGIL signature and the Gyeongsangbuk-do collaborator signature on one quiet horizontal baseline above the operations heading.
- The SALGIL signature switches between the supplied Korean and English SVG assets with the dashboard locale. The collaborator signature remains unchanged; neither asset is cropped or reconstructed in CSS, while the documented dark-rail state may render both signatures in monochrome white.
- A compact `한국어 / EN` segmented control shares the header row. It uses the existing neutral selected-control surface, visible focus, `aria-pressed`, and no decorative motion.
- The header stays inside the 300px left operations rail, never overlaps the first heading, and preserves readable logo clear space at both supported desktop acceptance widths.

### Console localization

- Supported locales are Korean (`ko`) and English (`en`) on `apps/console-front` only. The mobile client and renderer remain outside this localization boundary.
- The initial locale follows a saved dashboard preference and otherwise defaults to English. Locale changes update visible console copy, accessible names, document language, document title, district names, and the SALGIL signature together.
- Platform-provided incident headlines, routing notices, citations, and other source text remain verbatim so localization never changes operational evidence.

### Sidebar appearance

- The console starts with graphite dark rails and stores the operator's light or dark rail preference locally. The map canvas is never dimmed or color-shifted.
- One compact icon toggle sits at the upper-right of the district rail. It exposes `aria-pressed`, a localized action label, a visible focus ring, and no decorative animation.
- In dark mode, both supplied collaboration signatures use a white monochrome presentation so their shapes remain crisp on graphite. The QR code retains a white scan field.
- Dark rail controls use tonal separation rather than luminous borders: quiet white-alpha fields, one brighter selected surface, near-white primary text, and accessible muted text. The rail itself retains enough transparency for the 24px backdrop blur to be visible without competing with content. Semantic green, warning, and critical states remain distinguishable by text and structure.
- Opening the assistant replaces the right rail with the same selected material. Map zoom, map canvas, and centered map controls remain on the existing light material.

### Button

- Variants: primary, secondary, text, critical.
- Height: 40px desktop, 52px field.
- Radius: console push buttons use a full pill radius. Compact square utility controls remain circular. Resident mobile actions use the documented 8px action radius, while data surfaces retain a restrained 10px radius so the interface does not become a field of bubbles.
- States: hover via small background or border change; focus ring; disabled opacity and cursor.
- Motion: 110–140ms ease-out feedback. A press may compress to `0.975` and recover immediately; no bounce, elastic overshoot, or `transition: all`.

### Segmented control

- Structure: route tabs use a flat row; compact map controls pair a labeled three-segment camera track with a labeled two-segment basemap track so neither surface spreads behind its label.
- Selected state: compact modes use one quiet inset surface and tight shadow; inactive items remain transparent.
- Motion: the selected surface glides between options with a shared-position spring (`stiffness: 420`, `damping: 36`, `mass: 0.55`). It retargets immediately without bounce; reduced-motion mode switches the surface with zero-duration motion.
- Accessibility: implemented as buttons with `aria-pressed`.
- Hierarchy rule: only route or content-state navigation may use the full-width underlined row. A secondary context switch such as `Resident / Field team` is a compact, right-aligned control with a quiet selected fill and no divider, so two tab bars never stack.
- The content immediately following a tab row must not add another top divider. The tab row owns that boundary.

### Floating select

- The trigger is a 40px neutral control with a 10px radius, inset chevron, and enough right padding that the icon never touches the edge.
- The option popover is custom-rendered, keyboard navigable, and anchored within the owning panel. It opens with a 120ms opacity/translate transition and never uses bounce or a morphing glass effect.
- Opening aligns the selected option's center with the trigger's center whenever the panel boundary allows it. Long lists pre-scroll around the selected option instead of starting at the first item.
- The selected option uses a low-contrast neutral fill, a checkmark, and stronger text. Hover, focus, and selected states remain distinct without brand-colored fills.

### Checkbox

- Native checkbox semantics remain in the DOM. A 16px square neutral control and explicit checkmark provide the visible state.
- Focus is shown around the control, not the entire row. The label and count remain separately readable.

### Range slider

- The native range input retains pointer and keyboard semantics while a dedicated visual track renders the value continuously.
- The track is a slim neutral capsule with one solid ink fill. The circular thumb uses the strong floating surface, one quiet highlight edge, and the existing control shadow for a restrained glass cue; it grows slightly only while grabbed and never adds blur, glow, or a decorative gradient.
- The fill follows optimistic state without an easing delay. Reduced-motion mode removes the thumb transform while preserving immediate value feedback.

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

- Structure: real interactive basemap and one consolidated left operations panel. The previous evacuation-plan, contact-status, and field-task routes are redirected to the situation map and are no longer exposed in navigation.
- Floating controls: brand identity with a real mobile QR, incident heading, and renderer controls share the left edge. Event controls expose one training/live mode switch and compact disaster actions; point hazards enter an explicit map-placement state. Normal connectivity, FPS, and platform stream badges are not repeated. The rail uses an 88% neutral fill, 18px blur, a 14px radius, and spacing instead of internal section rules wherever alignment is sufficient.
- Route dock: four routes appear in a compact centered horizontal row near the lower safe area. The dock uses an 82% neutral blurred surface; the active route uses a quiet neutral inset fill and near-black text. Inactive routes remain neutral gray, never blue.
- Floating work sheets: plan, contact, and field-task routes retain the live map behind a centered, bounded 82–86% white reading lens. The sheet owns its vertical scroll and leaves map context visible around its edges. Existing table boxes are flattened so the lens, not an old page container, owns the visual hierarchy.
- Map plane: the WebGPU terrain renderer is visually primary. It is isolated in an iframe. The default camera frames the complete mainland Gyeongsangbuk-do operating area, and switching between flat and 3D views preserves that extent. When embedded by the dashboard, local simulation stays paused: the renderer may draw the operator-selected origin immediately, but spread, phase changes, and forecast zones arrive from the platform stream.
- Map attribution: the console keeps one persistent, non-interactive provider line at the lower edge of the unobstructed map area, outside both side rails. It credits TMAP MOBILITY and the OpenStreetMap/CARTO fallback in 10px tertiary text on one restrained neutral surface; operational panels must never cover it.
- Overlay groups: communities, multi-hazard exposure, evacuation routes, access constraints, shelters, and field teams. Every group has a labelled checkbox and a numeric count.
- Map objects: compact square or diamond markers with persistent short labels. Selected communities use a cobalt outline and remain paired with a textual inspector. Labels use a Wanted-inspired tooltip anatomy: solid white, 4px radius, one neutral hairline, one tight contact shadow, 12px Pretendard, and a short centered tail that ties the label to its coordinate. A selected origin anchors below its coordinate with an upward tail while ordinary destinations anchor above with a downward tail, preventing same-row overlap in the route overview. Hazard and closure labels stay white and carry urgency only through the semantic glyph and weight; dark glass, blur, coloured leading rails, hover scale, and diffuse shadows are excluded. Actionable labels change border and surface tone on hover/focus without moving away from the map point.
- Hazard areas: translucent geometry plus a named legend item; never color alone. Routes use safe green when open, action blue when selected, and dashed critical red only for a blocked segment.
- Incident details appear only when supplied by the platform event; the console does not carry a static selected-community inspector.
- Timeline: latest four decision events in time order. It uses one structural divider and no individual cards.
- Motion: map pan/zoom and immediate overlay visibility only. Route changes update the map and written explanation together.
- Fallback: if online tiles are unavailable, the map region states that the basemap is unavailable while retaining overlay controls and the textual community list.

### Public data assistant

- Structure: one 48px circular icon launcher at the lower-right of the right rail opens a full-height right-side evidence drawer. Its accessible name carries the text label. The drawer temporarily replaces the district context so the map remains unobstructed.
- Material: the drawer uses the same 94% neutral floating surface, quiet border, 18px blur, and restrained shadow as dense operational reading surfaces. Messages remain row-led; only the operator message gets one weak neutral fill.
- Content: questions are routed to the SALGIL public-data MCP. Explicit training requests invoke the platform event tool path and are labelled as training in every client. Data answers show incomplete-source warnings, observation time, and source links when supplied; the assistant never decides an evacuation priority or invents missing data.
- Scroll ownership: the transcript alone scrolls between the fixed header and fixed composer. Long source URLs wrap without widening the drawer.
- Motion: the drawer enters 18px from the right over 160ms and exits the same way. Reduced-motion mode uses opacity only; Escape and the explicit close control dismiss it.
- Accessibility: the launcher, close control, composer, status, and transcript have explicit accessible names. Enter submits, Shift+Enter adds a line, and focus remains visibly indicated.

### Empty and feedback state

- Structure: concise title, one explanatory sentence, one optional action.
- Placement: inside the content region that owns the missing data.
- Feedback: updates use `aria-live="polite"`; destructive or urgent notices use `role="alert"`.

## 6. Motion & Interaction

- React Router keeps `/situation` as the single dashboard surface and redirects legacy paths there. The bottom dock is status-only and never navigates into the separate mobile client.
- Navigation, buttons, and compact map controls compress to `0.975` for roughly 100ms while pressed. Selection and disclosure transitions are limited to 110–160ms opacity, transform, or background color.
- Camera and basemap segments use the beui.dev tabs mechanism: one shared `layoutId` selection surface moves with the compact `420 / 36 / 0.55` spring. Only the position changes; the label never slides or blurs.
- Map control values, including camera and basemap selection, update optimistically in the console. Continuous rainfall input is coalesced to one renderer command per animation frame so the thumb and numeric label never wait for iframe state acknowledgement.
- Plan approval, contact completion, and field reporting update persistent state within the session and announce the change.
- Reduced-motion preferences remove nonessential transitions.
- Keyboard order follows visual order. No hover-only information exists.

### Resident demo states

- **Normal:** “You’re safe for now,” one safety-check action, 72% preparedness, four quick actions, and family/contact states.
- **Alert:** one orange warning and one directive, “Move to higher ground now.” The dominant action reveals a safe route; Call 119 is the only red control.
- **Route:** a green route, nearest safe shelter, travel time, ordered checklist, and a single evacuation progress action.
- The demo mode switch exposes all three states for judging, but the content itself remains usable without understanding the switch.
- QR entrants are assigned to the shared `청송군 진보면 공동 데모 지점` rather than GPS. Every mobile demo client therefore receives the same platform event, location summary, and safety steps; notification permission is handled by the entry gate below.
- The mobile shell uses a stable map-and-sheet split: the interactive 2D map owns the upper 58dvh and the white guidance sheet owns the remainder with bounded scrolling. The 44px sheet handle toggles between the expanded guidance view and a 64px collapsed affordance; collapsing gives the map the full viewport and expanding restores the route framing. The transition uses a 150ms transform-only ease-out and becomes immediate under reduced motion. Drag and pinch gestures remain enabled, 44px zoom controls provide an accessible fallback, and a `View full route` action restores the computed route bounds. The fixed Jinbo-myeon demo coordinate is explicit and never presented as a live GPS fix. The screen has no product header, floating logo, satellite view, terrain presentation, or acknowledgement-only action; row separators replace nested cards. Current platform events remain the authoritative source of disaster state, while a clearly labelled fixed demo route is used only when the demo backend cannot return routing data.
- On first mobile entry, notification permission gates the demo unless system notifications are already granted. The modal cannot dismiss a default or denied permission state: its primary action requests permission from a user gesture, prevents duplicate requests while pending, and turns into browser-settings recovery instructions after denial. Unsupported browsers may continue to the demo because no permission path exists. Browser permission remains authoritative; the app never claims it can force a user or browser to grant notifications.
- Mobile surfaces follow the Wanted-inspired product grammar recorded in the research log: left-aligned intent-first typography, solid white layers, neutral row rules, an 8px action radius, a 12px permission-dialog radius, and a 16px top-sheet radius. Decorative eyebrow labels, tinted icon tiles, blurred controls, pulsing status dots, one-hue status cards, and diffuse shadows are excluded. The permission gate has no decorative icon; its title, direct explanation, recovery rows, and one action form the entire hierarchy.

## 7. Depth & Surface

- The live map, spacing, type weight, and neutral selected states provide the hierarchy.
- The operations map, plan, contact roster, and field-task pages share the same surface ladder: map canvas → quiet floating blur → high-opacity reading surface.
- Most regions have no outer border. Low-contrast lines are reserved for app-shell boundaries, table rows, and form fields.
- Tabs and selected navigation use color, weight, and an underline or quiet tint; shadows are excluded.
- Resident status surfaces use a neutral white surface and one quiet border. Safety or warning color belongs to the status label, not simultaneously to border, background, and text.
- Diffuse card shadows are excluded. The only retained shadow is the tight selected-segment shadow because it communicates control state.
- Panels never contain independent card grids. Summary values share one quiet band without individual boxes.
- Full-map floating surfaces use 24px backdrop blur and one restrained shadow. A quiet border is added only where the map and surface would otherwise merge; side rails and the route dock normally rely on fill and shadow. They do not use refractive rims, glow, colored glass, or nested translucent containers.

## 8. Accessibility Constraints & Accepted Debt

- Target contrast is WCAG AA for text and controls.
- Focus is visible on every interactive element.
- Touch targets are at least 44px on the field app.
- Maps are duplicated by the layer rail, inspector, route summary, and timeline so map interpretation is never the only path to information.
- Accepted prototype debt: operational geometry and the shared mobile demo coordinate are static. There is no authentication, telephony, or routing engine. Until the platform backend is available, POST failures fall back to an explicitly labelled local preview and same-browser `BroadcastChannel` synchronization; real cross-device synchronization requires the documented SSE endpoint. The iframe URL is supplied through `VITE_MAP_URL`; production deployment must configure its final map origin explicitly.
- Accepted responsive debt: `console-front` intentionally targets desktop command workstations. Narrow-screen resident and patrol use cases are owned by `apps/mobile` rather than a compressed console.
