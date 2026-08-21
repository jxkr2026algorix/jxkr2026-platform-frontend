const roleButtons = document.querySelectorAll("[data-role]");
const rolePanels = document.querySelectorAll("[data-role-panel]");
const modeButtons = document.querySelectorAll("[data-mode]");
const modePanels = document.querySelectorAll("[data-mode-panel]");
let evacuationStep = 0;

function showRole(role) {
  roleButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.role === role)));
  rolePanels.forEach((panel) => panel.classList.toggle("is-active", panel.dataset.rolePanel === role));
  if (role === "patrol") location.hash = "patrol"; else history.replaceState(null, "", location.pathname);
}

roleButtons.forEach((button) => button.addEventListener("click", () => showRole(button.dataset.role)));

function showResidentMode(mode) {
  modeButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
  modePanels.forEach((panel) => panel.classList.toggle("is-active", panel.dataset.modePanel === mode));
  document.getElementById("resident-feedback").hidden = true;
}

function showResidentFeedback(message) {
  const feedback = document.getElementById("resident-feedback");
  feedback.hidden = false;
  feedback.textContent = message;
}

modeButtons.forEach((button) => button.addEventListener("click", () => showResidentMode(button.dataset.mode)));

document.getElementById("start-safety-check").addEventListener("click", (event) => {
  event.currentTarget.textContent = "Safety check complete";
  event.currentTarget.disabled = true;
  showResidentFeedback("You’re prepared. Your contacts and current location are ready to share if needed.");
});

document.getElementById("show-safe-route").addEventListener("click", () => showResidentMode("route"));

document.querySelectorAll("[data-quick-action]").forEach((button) => button.addEventListener("click", () => {
  const action = button.dataset.quickAction;
  if (action === "route") {
    showResidentMode("route");
    return;
  }
  const messages = {
    emergency: "Emergency call handoff is ready. Call 119 only when you need immediate help.",
    share: "Your current location is ready to share with a trusted contact.",
    checklist: "Checklist ready: medicine, water, charger, identification, and meeting point."
  };
  showResidentFeedback(messages[action]);
}));

document.querySelectorAll("[data-alert-action]").forEach((button) => button.addEventListener("click", () => {
  const messages = {
    call: "Emergency call handoff is ready for 119.",
    share: "Your live location is ready to share with your family.",
    checklist: "Evacuation checklist ready: phone, medicine, identification, and water."
  };
  showResidentFeedback(messages[button.dataset.alertAction]);
}));

document.getElementById("request-help").addEventListener("click", (event) => {
  event.currentTarget.disabled = true;
  event.currentTarget.textContent = "Request received";
  showResidentFeedback("Support request received. Operations is assigning a vehicle to the Sangchon community hall.");
});

document.getElementById("evacuation-action").addEventListener("click", (event) => {
  const feedback = document.getElementById("resident-feedback");
  evacuationStep += 1;
  feedback.hidden = false;
  if (evacuationStep === 1) {
    event.currentTarget.textContent = "Confirm shelter arrival";
    document.getElementById("route-status").textContent = "Evacuating · north bypass active";
    feedback.textContent = "Operations received your departure status. Continue on the assigned route.";
  } else {
    event.currentTarget.textContent = "Arrival confirmed";
    event.currentTarget.disabled = true;
    document.getElementById("route-status").textContent = "Arrival confirmed at Jinbo Sports Center";
    feedback.textContent = "Your arrival is confirmed. Follow instructions from the shelter team.";
  }
});

document.getElementById("start-task").addEventListener("click", (event) => {
  event.currentTarget.disabled = true;
  event.currentTarget.textContent = "Task in progress";
  document.getElementById("patrol-status").textContent = "In progress";
  document.getElementById("field-report").hidden = false;
  document.getElementById("field-report").scrollIntoView({ behavior: "smooth", block: "start" });
});

document.getElementById("field-report-form").addEventListener("submit", (event) => {
  event.preventDefault();
  document.getElementById("patrol-status").textContent = "Report submitted";
  document.getElementById("field-report").hidden = true;
  const feedback = document.getElementById("patrol-feedback");
  feedback.hidden = false;
  feedback.textContent = "Operations received the Sangchon access closure. The evacuation route now requires review.";
  feedback.scrollIntoView({ behavior: "smooth", block: "center" });
});

showRole(location.hash === "#patrol" ? "patrol" : "resident");
showResidentMode("normal");
