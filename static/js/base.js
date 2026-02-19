document.addEventListener("DOMContentLoaded", function() {
    const hamburger = document.getElementById("btnToggleSidebar");
    const sidebar = document.querySelector(".sidebar");
    
    if (!hamburger || !sidebar) return;
    
    // Toggle sidebar on hamburger click
    hamburger.addEventListener("click", function(e) {
        e.preventDefault();
        e.stopPropagation();
        sidebar.classList.toggle("open");
        
        // Update hamburger icon
        if (sidebar.classList.contains("open")) {
            hamburger.textContent = "✕"; // Close icon
        } else {
            hamburger.textContent = "☰"; // Hamburger icon
        }
    });
    
    // Close sidebar when clicking outside on mobile
    document.addEventListener("click", function(e) {
        if (window.innerWidth <= 1024) {
            if (!sidebar.contains(e.target) && !hamburger.contains(e.target)) {
                sidebar.classList.remove("open");
                hamburger.textContent = "☰";
            }
        }
    });
    
    // Handle window resize
    window.addEventListener("resize", function() {
        if (window.innerWidth > 1024) {
            sidebar.classList.remove("open");
            hamburger.textContent = "☰";
            hamburger.style.display = "none";
        } else {
            hamburger.style.display = "block";
        }
    });
    
    // Initial check
    if (window.innerWidth > 1024) {
        hamburger.style.display = "none";
    } else {
        hamburger.style.display = "block";
    }
});