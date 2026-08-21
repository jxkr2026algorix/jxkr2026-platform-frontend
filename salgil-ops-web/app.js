const state = {
  view: location.hash.slice(1) || "situation",
  approved: false,
  contacted: false,
  reported: false,
  selectedVillage: "Sangchon",
};

const villageDetails = {
  Sangchon: { coordinates: [36.443, 129.024], residents: "34", status: "Evacuate now", hazard: "Slope failure risk", support: "12 mobility needs", shelter: "Jinbo Sports Center", transport: "Bus 1 · ambulance", update: "14:08 · sensor fusion", note: "Exposure and mobility needs place Sangchon first. The eastern approach is blocked." },
  Wolwe: { coordinates: [36.469, 129.082], residents: "27", status: "Prepare evacuation", hazard: "Wildfire approach", support: "4 assisted transfers", shelter: "Jinbo Sports Center", transport: "Bus 1", update: "14:06 · fire watch", note: "Wildfire movement has narrowed the safe departure window. Keep the western route clear." },
  Bunam: { coordinates: [36.403, 129.047], residents: "15", status: "Monitor access", hazard: "Road access disruption", support: "2 transport needs", shelter: "Bunam Community Center", transport: "Response van", update: "14:02 · road team", note: "The primary bridge remains open, but the northern approach requires active monitoring." },
  Juwangsan: { coordinates: [36.417, 129.104], residents: "10", status: "Monitor services", hazard: "Power and communications outage", support: "Radio check required", shelter: "Juwangsan Visitor Center", transport: "Standby vehicle", update: "13:56 · utility report", note: "Power and communications remain unstable. Maintain radio contact and standby transport." },
};

let operationsMap;
let mapTileLayer;
let revisedRoute;
const mapLayers = {};
const mapCommunityMarkers = {};

function cssToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function communityIcon(name) {
  const selected = state.selectedVillage === name;
  return L.divIcon({
    className: "map-community-icon",
    html: selected ? `<span class="map-community-label is-selected">${name}</span>` : '<span class="map-community-dot" aria-hidden="true"></span>',
    iconSize: selected ? [92, 30] : [16, 16],
    iconAnchor: selected ? [46, 15] : [8, 8],
  });
}

function labelledIcon(className, label, iconAnchor = [66, 14]) {
  const labelClass = className.replace("-icon", "-label");
  const visibleLabel = className === "map-team-icon" ? "" : label;
  return L.divIcon({ className, html: `<span class="${labelClass}">${visibleLabel}</span>`, iconSize: [132, 28], iconAnchor });
}

function updateMapSelection(name, shouldPan = false) {
  Object.entries(mapCommunityMarkers).forEach(([community, marker]) => {
    marker.setIcon(communityIcon(community));
  });
  const marker = mapCommunityMarkers[name];
  if (shouldPan && operationsMap && marker && window.innerWidth > 1100) operationsMap.panTo(marker.getLatLng(), { animate: false });
}

function initOperationsMap() {
  const fallback = document.getElementById("map-fallback");
  if (!window.L) {
    document.getElementById("operations-map").hidden = true;
    fallback.hidden = false;
    return;
  }

  const safe = cssToken("--safe");
  const alert = cssToken("--alert");
  const criticalInk = cssToken("--critical-ink");
  operationsMap = L.map("operations-map", { center: [36.435, 129.06], zoom: 12, zoomControl: true, preferCanvas: true });
  mapTileLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(operationsMap);

  let tilesLoaded = false;
  mapTileLayer.once("load", () => { tilesLoaded = true; fallback.hidden = true; });
  window.setTimeout(() => { if (!tilesLoaded) fallback.hidden = false; }, 4500);

  mapLayers.hazards = L.layerGroup([
    L.circle(villageDetails.Sangchon.coordinates, { radius: 1700, color: alert, weight: 1.5, fillColor: alert, fillOpacity: .12 }).bindTooltip("Slope failure exposure", { sticky: true, className: "hazard-tooltip" }),
    L.circle(villageDetails.Wolwe.coordinates, { radius: 2100, color: alert, weight: 1.5, dashArray: "6 5", fillColor: alert, fillOpacity: .08 }).bindTooltip("Wildfire watch", { sticky: true, className: "hazard-tooltip" }),
    L.polygon([[36.428, 129.034], [36.434, 129.044], [36.421, 129.051]], { color: criticalInk, weight: 2, fillColor: criticalInk, fillOpacity: .1 }).bindTooltip("Access constraint", { sticky: true, className: "hazard-tooltip" }),
  ]).addTo(operationsMap);

  mapLayers.routes = L.layerGroup([
    L.polyline([villageDetails.Sangchon.coordinates, [36.438, 129.041], [36.454, 129.057]], { color: safe, weight: 4, opacity: .9 }),
    L.polyline([villageDetails.Wolwe.coordinates, [36.462, 129.066], [36.454, 129.057]], { color: safe, weight: 3, opacity: .72 }),
  ]).addTo(operationsMap);

  const communityMarkers = Object.entries(villageDetails).map(([name, details]) => {
    const marker = L.marker(details.coordinates, { icon: communityIcon(name), keyboard: true, title: name });
    marker.on("click", () => selectVillage(name));
    mapCommunityMarkers[name] = marker;
    return marker;
  });
  mapLayers.communities = L.layerGroup(communityMarkers).addTo(operationsMap);

  mapLayers.shelters = L.layerGroup([
    L.marker([36.454, 129.057], { icon: labelledIcon("map-shelter-icon", "Jinbo Sports Center", [78, 14]), title: "Jinbo Sports Center" }),
    L.marker([36.399, 129.056], { icon: labelledIcon("map-shelter-icon", "Bunam Center"), title: "Bunam Center" }),
  ]).addTo(operationsMap);

  mapLayers.teams = L.layerGroup([
    L.marker([36.438, 129.037], { icon: labelledIcon("map-team-icon", "Field team 2"), title: "Field team 2" }).bindTooltip("Field team 2", { direction: "top", className: "hazard-tooltip" }),
    L.marker([36.458, 129.067], { icon: labelledIcon("map-team-icon", "Road team 1"), title: "Road team 1" }).bindTooltip("Road team 1", { direction: "top", className: "hazard-tooltip" }),
    L.marker([36.421, 129.091], { icon: labelledIcon("map-team-icon", "Medical unit"), title: "Medical unit" }).bindTooltip("Medical unit", { direction: "top", className: "hazard-tooltip" }),
  ]).addTo(operationsMap);

  mapLayers.constraints = L.layerGroup([
    L.marker([36.429, 129.042], { icon: labelledIcon("map-constraint-icon", "Road 12 closed"), title: "County Road 12 closed" }),
  ]).addTo(operationsMap);

  document.querySelectorAll("[data-map-layer]").forEach((input) => {
    input.addEventListener("change", () => {
      const layer = mapLayers[input.dataset.mapLayer];
      if (!layer) return;
      if (input.checked) layer.addTo(operationsMap); else operationsMap.removeLayer(layer);
      document.getElementById("operations-map").dataset[`${input.dataset.mapLayer}Visible`] = String(input.checked);
    });
  });

  operationsMap.attributionControl.setPrefix(false);
  window.SALGIL_MAP_DEBUG = { map: operationsMap, layers: mapLayers };
  updateMapSelection(state.selectedVillage);
  requestAnimationFrame(() => requestAnimationFrame(() => operationsMap.invalidateSize()));
}

function applyRevisedRouteToMap() {
  if (!operationsMap || revisedRoute) return;
  revisedRoute = L.polyline([[36.443, 129.024], [36.451, 129.011], [36.462, 129.033], [36.454, 129.057]], {
    color: cssToken("--action"), weight: 4, dashArray: "8 6", opacity: .9,
  }).bindTooltip("North bypass", { sticky: true, className: "hazard-tooltip" }).addTo(mapLayers.routes);
  L.marker([36.454, 129.015], { icon: labelledIcon("map-constraint-icon", "New closure", [30, 40]), title: "New access closure" }).addTo(mapLayers.constraints);
}

function showView(view) {
  const next = document.querySelector(`[data-view-panel="${view}"]`) ? view : "situation";
  state.view = next;
  location.hash = next;
  document.querySelectorAll("[data-view-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.viewPanel === next));
  document.querySelectorAll("[data-view]").forEach((button) => {
    const current = button.dataset.view === next;
    button.classList.toggle("is-current", current);
    if (current) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  const mobileNav = document.getElementById("mobile-nav");
  mobileNav.hidden = true;
  document.getElementById("mobile-menu").setAttribute("aria-expanded", "false");
  document.querySelector("main").scrollTo({ top: 0 });
  window.scrollTo({ top: 0 });
  document.getElementById("main-content").focus({ preventScroll: true });
  if (next === "situation" && operationsMap) requestAnimationFrame(() => requestAnimationFrame(() => operationsMap.invalidateSize()));
}

function selectVillage(name) {
  state.selectedVillage = name;
  document.querySelectorAll("[data-village]").forEach((item) => {
    const selected = item.dataset.village === name;
    item.classList.toggle("selected", selected);
    if (item.getAttribute("role") === "option") item.setAttribute("aria-selected", String(selected));
  });
  const details = villageDetails[name];
  document.getElementById("detail-community").textContent = name;
  document.getElementById("detail-status").textContent = details.status;
  document.getElementById("detail-residents").textContent = details.residents;
  document.getElementById("detail-hazard").textContent = details.hazard;
  document.getElementById("detail-support").textContent = details.support;
  document.getElementById("detail-shelter").textContent = details.shelter;
  document.getElementById("detail-transport").textContent = details.transport;
  document.getElementById("detail-update").textContent = details.update;
  document.getElementById("detail-note").textContent = details.note;
  updateMapSelection(name, true);
}

function approvePlan() {
  state.approved = true;
  const status = document.getElementById("plan-state");
  status.classList.add("is-approved");
  status.lastChild.textContent = "Approved";
  const button = document.getElementById("approve-plan");
  button.textContent = "Approved";
  button.disabled = true;
  const feedback = document.getElementById("approval-feedback");
  feedback.hidden = false;
  feedback.innerHTML = "Plan approved at 14:12. Continue to <span class=\"nowrap\">resident contact</span>.";
  document.getElementById("start-contact").disabled = false;
  document.getElementById("contact-eyebrow").textContent = "Approved plan";
  const contactStatus = document.getElementById("contact-state");
  contactStatus.classList.add("is-approved");
  contactStatus.lastChild.textContent = "Ready";
  document.querySelectorAll("#contact-rows tr").forEach((row) => {
    row.querySelector("[data-result]").textContent = "Ready";
    row.querySelector("[data-action]").textContent = "Start resident contact";
  });
}

function startContact() {
  if (!state.approved) {
    showView("plan");
    const feedback = document.getElementById("approval-feedback");
    feedback.hidden = false;
    feedback.textContent = "Approve the evacuation plan before contacting residents.";
    return;
  }
  state.contacted = true;
  const results = [
    ["Evacuating", "Moving to assembly point"],
    ["Support requested", "Vehicle assigned for 2 residents"],
    ["Unreachable", "Field team 2 verification required"],
  ];
  document.querySelectorAll("#contact-rows tr").forEach((row, index) => {
    const result = row.querySelector("[data-result]");
    result.textContent = results[index][0];
    result.className = ["is-evacuating", "is-support", "is-unreachable"][index];
    row.querySelector("[data-action]").textContent = results[index][1];
  });
  document.getElementById("safe-count").textContent = "63";
  document.getElementById("help-count").textContent = "11";
  document.getElementById("no-answer-count").textContent = "2";
  const status = document.getElementById("contact-state");
  status.classList.add("is-approved");
  status.lastChild.textContent = "Contact complete";
  const feedback = document.getElementById("contact-feedback");
  feedback.hidden = false;
  feedback.innerHTML = "Two households are unreachable. <button class=\"button secondary\" data-go=\"patrol\">Assign field verification</button>";
  document.getElementById("house-task-state").textContent = "Priority assigned";
  document.getElementById("start-contact").textContent = "Refresh results";
}

function submitReport(event) {
  event.preventDefault();
  state.reported = true;
  state.approved = false;
  document.getElementById("report-panel").hidden = true;
  document.getElementById("house-task-state").textContent = "Report submitted";
  const reportButton = document.getElementById("open-report");
  reportButton.textContent = "Report submitted";
  reportButton.disabled = true;
  document.getElementById("road-count").textContent = "2";
  document.getElementById("route-count").textContent = "3";
  applyRevisedRouteToMap();
  document.getElementById("map-revision-banner").hidden = false;
  document.getElementById("timeline-latest-time").textContent = "14:18";
  document.getElementById("timeline-latest-event").textContent = "North bypass proposed after new closure";
  document.getElementById("detail-note").textContent = "A new access closure blocks the eastern approach. Operations proposes the north bypass and requires plan reapproval.";
  document.getElementById("detail-update").textContent = "14:18 · field report";
  document.getElementById("route-cell").textContent = "Bus 1 · north bypass";
  document.getElementById("route-reason").textContent = "Field access report";
  const planStatus = document.getElementById("plan-state");
  planStatus.classList.remove("is-approved");
  planStatus.lastChild.textContent = "Reapproval required";
  const approvalButton = document.getElementById("approve-plan");
  approvalButton.disabled = false;
  approvalButton.textContent = "Approve revised plan";
  document.getElementById("start-contact").disabled = true;
  document.getElementById("contact-eyebrow").textContent = "Reapproval required";
  const contactStatus = document.getElementById("contact-state");
  contactStatus.classList.remove("is-approved");
  contactStatus.lastChild.textContent = "Contact paused";
  const feedback = document.getElementById("replan-feedback");
  feedback.hidden = false;
  feedback.innerHTML = "<span>The Sangchon access report changed the route to the <span class=\"nowrap\">north bypass</span>.</span><button class=\"button primary\" data-go=\"plan\">Review revised plan</button>";
}

function resetDemo() {
  state.approved = false;
  state.contacted = false;
  state.reported = false;
  location.reload();
}

document.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-view], [data-go]");
  if (nav) showView(nav.dataset.view || nav.dataset.go);
  const village = event.target.closest("[data-village]");
  if (village) selectVillage(village.dataset.village);
});

document.getElementById("approve-plan").addEventListener("click", approvePlan);
document.getElementById("start-contact").addEventListener("click", startContact);
document.getElementById("open-report").addEventListener("click", () => { document.getElementById("report-panel").hidden = false; });
document.getElementById("close-report").addEventListener("click", () => { document.getElementById("report-panel").hidden = true; });
document.getElementById("report-form").addEventListener("submit", submitReport);
document.getElementById("reset-demo").addEventListener("click", resetDemo);
document.getElementById("center-selection").addEventListener("click", () => updateMapSelection(state.selectedVillage, true));
document.getElementById("mobile-menu").addEventListener("click", (event) => {
  const menu = document.getElementById("mobile-nav");
  menu.hidden = !menu.hidden;
  event.currentTarget.setAttribute("aria-expanded", String(!menu.hidden));
});
window.addEventListener("hashchange", () => showView(location.hash.slice(1)));

document.getElementById("start-contact").disabled = true;
initOperationsMap();
showView(state.view);
