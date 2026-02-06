document.addEventListener("DOMContentLoaded", () => {

    const transportGrid = document.getElementById("transportGrid");
    const transportModal = document.getElementById("transportModal");
    const btnOpenTransportModal = document.getElementById("btnOpenTransportModal");
    const closeModalBtn = transportModal.querySelector(".close");
    const transportForm = document.getElementById("transportForm");
    const transportSearch = document.getElementById("transportSearch");

    let editingID = null;
    let transportData = {};

    /* ---------- Toast ---------- */
    function showToast(message, icon = "success") {
        Swal.fire({
            toast: true,
            position: "bottom-end",
            showConfirmButton: false,
            timer: 2500,
            icon,
            title: message
        });
    }

    /* ---------- API ---------- */
    async function fetchTransportUnits() {
        const res = await fetch("/api/admin/transport-units");
        transportData = await res.json();
        renderTransportUnits(transportData);
    }

    async function saveTransportUnit(data, id = null) {
        const url = id
            ? `/api/admin/transport-units/${id}`
            : `/api/admin/transport-units`;

        const res = await fetch(url, {
            method: id ? "PUT" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });

        if (!res.ok) {
            showToast("Failed to save transport unit", "error");
            return;
        }

        showToast("Transport unit saved");
        transportModal.style.display = "none";
        fetchTransportUnits();
    }

    async function deleteTransportUnit(id) {
        const confirm = await Swal.fire({
            title: "Delete transport unit?",
            icon: "warning",
            showCancelButton: true,
            confirmButtonText: "Delete"
        });

        if (!confirm.isConfirmed) return;

        await fetch(`/api/admin/transport-units/${id}`, { method: "DELETE" });
        showToast("Transport unit deleted");
        fetchTransportUnits();
    }

    /* ---------- Render ---------- */
    function renderTransportUnits(data) {
        transportGrid.innerHTML = "";

        const search = transportSearch.value.toLowerCase();
        const units = data.units || []; // extract array

        const filtered = units.filter(u =>
            u.unitType.toLowerCase().includes(search) ||
            u.name.toLowerCase().includes(search) ||
            u.color.toLowerCase().includes(search) ||
            u.plateNo.toLowerCase().includes(search)
        );

        if (!filtered.length) {
            transportGrid.innerHTML = `<p style="text-align:center;color:#6b7280;">No transport units found.</p>`;
            return;
        }

        filtered.forEach(u => {
            const card = document.createElement("div");
            card.className = "card";

            card.innerHTML = `
                <h3>${u.name}</h3>
                <p>Type: ${u.unitType}</p>
                <p>Color: ${u.color}</p>
                <p>Plate: ${u.plateNo}</p>
                <div class="card-actions">
                    <button class="btn-edit">Edit</button>
                    <button class="btn-delete">Delete</button>
                </div>
            `;

            card.querySelector(".btn-edit").onclick = () => {
                editingID = u.id;
                transportForm.unitType.value = u.unitType;
                transportForm.transportUnit.value = u.name;
                transportForm.color.value = u.color;
                transportForm.plateNumber.value = u.plateNo;
                transportModal.style.display = "flex";
            };

            card.querySelector(".btn-delete").onclick = () => deleteTransportUnit(u.id);

            transportGrid.appendChild(card);
        });
    }

    /* ---------- Modal ---------- */
    btnOpenTransportModal.onclick = () => {
        editingID = null;
        transportForm.reset();
        transportModal.style.display = "flex";
    };

    closeModalBtn.onclick = () => transportModal.style.display = "none";

    window.onclick = e => {
        if (e.target === transportModal) transportModal.style.display = "none";
    };

    /* ---------- Form ---------- */
    transportForm.onsubmit = e => {
        e.preventDefault();

        saveTransportUnit({
            unitType: transportForm.unitType.value.trim(),
            transportUnit: transportForm.transportUnit.value.trim(),
            color: transportForm.color.value.trim(),
            plateNumber: transportForm.plateNumber.value.trim()
        }, editingID);
    };

    transportSearch.addEventListener("input", () => {
        renderTransportUnits(transportData);
    });

    /* ---------- Init ---------- */
    fetchTransportUnits();
});
