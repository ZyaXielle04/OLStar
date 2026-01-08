document.addEventListener("DOMContentLoaded", () => {

  // ---------------------------
  // Login Modal
  // ---------------------------
  const modal = document.getElementById("loginModal");
  const loginBtnDesktop = document.getElementById("loginBtnDesktop");
  const closeModal = document.getElementById("closeModal");

  loginBtnDesktop?.addEventListener("click", (e) => {
    e.preventDefault();
    modal.style.display = "flex";
  });

  closeModal?.addEventListener("click", () => {
    modal.style.display = "none";
  });

  window.addEventListener("click", (e) => {
    if (e.target === modal) modal.style.display = "none";
  });

  // ---------------------------
  // Toggle Password Visibility
  // ---------------------------
  const togglePassword = document.getElementById("togglePassword");
  const passwordInput = document.getElementById("password");

  togglePassword?.addEventListener("click", () => {
    const type = passwordInput.getAttribute("type") === "password" ? "text" : "password";
    passwordInput.setAttribute("type", type);
    togglePassword.textContent = type === "password" ? "👁️" : "🙈";
  });

  // ---------------------------
  // Get CSRF token from cookie
  // ---------------------------
  function getCsrfToken() {
    const name = "XSRF-TOKEN=";
    const decodedCookie = decodeURIComponent(document.cookie);
    const ca = decodedCookie.split(";");
    for (let c of ca) {
      c = c.trim();
      if (c.startsWith(name)) return c.substring(name.length);
    }
    return "";
  }

  // ---------------------------
  // Admin Login via Flask API with SweetAlert
  // ---------------------------
  const loginForm = document.getElementById("loginForm");

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("email")?.value.trim();
    const password = document.getElementById("password")?.value.trim();

    if (!email || !password) {
      return Swal.fire({
        icon: "warning",
        title: "Oops!",
        text: "Please enter email & password",
      });
    }

    try {
      const csrfToken = getCsrfToken();
      if (!csrfToken) {
        return Swal.fire({
          icon: "error",
          title: "CSRF Token Missing",
          text: "Refresh the page and try again.",
        });
      }

      const res = await fetch("/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrfToken
        },
        body: JSON.stringify({ email, password })
      });

      let result = null;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        try {
          result = await res.json();
        } catch (err) {
          const text = await res.text();
          console.error("Invalid JSON response:", text);
          return Swal.fire({
            icon: "error",
            title: "Login Failed",
            text: "Server returned invalid response."
          });
        }
      } else {
        const text = await res.text();
        console.error("Non-JSON response:", text);
        return Swal.fire({
          icon: "error",
          title: "Login Failed",
          text: "Unexpected server response."
        });
      }

      // ---------------------------
      // Success or failure
      // ---------------------------
      if (res.ok && result?.status === "success" && result.redirect) {
        modal.style.display = "none";
        Swal.fire({
          icon: "success",
          title: "Login Successful!",
          text: "Redirecting to Admin Dashboard...",
          timer: 1500,
          showConfirmButton: false,
          didClose: () => {
            window.location.href = result.redirect;
          }
        });
      } else {
        Swal.fire({
          icon: "error",
          title: "Login Failed",
          text: result?.error || "Incorrect email or password",
        });
      }

    } catch (err) {
      console.error("Network or JS error:", err);
      Swal.fire({
        icon: "error",
        title: "Login Failed",
        text: "Network or server error. Try again later.",
      });
    }
  });

});
