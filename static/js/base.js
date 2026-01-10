document.addEventListener("DOMContentLoaded", () => {
  const btnToggleSidebar = document.getElementById("btnToggleSidebar");
  const sidebar = document.querySelector(".sidebar");

  if (btnToggleSidebar && sidebar) {
    btnToggleSidebar.addEventListener("click", () => {
      sidebar.classList.toggle("open");
    });
  }
});
