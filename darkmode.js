let darkmode = localStorage.getItem('darkmode')
const themeSwitch = document.getElementById('theme-switch')

const enableDarkmode = () => {
    document.body.classList.add('darkmode')
    localStorage.setItem('darkmode', 'active')
}

const disableDarkmode = () => {
    document.body.classList.remove('darkmode')
    localStorage.setItem('darkmode', 'null')
}

if (darkmode === "active") enableDarkmode()

themeSwitch.addEventListener('click', () => {
    darkmode = localStorage.getItem('darkmode')
    darkmode !== "active" ? enableDarkmode() : disableDarkmode()
})

// ---------- API + IMAGE ----------
const form = document.getElementById('uploadForm');
const gallery = document.getElementById('photoGallery');
const imageInput = document.getElementById('petImage');
const previewImage = document.getElementById('preview');

const apiBaseUrl = "https://i4lwox07l9.execute-api.us-east-1.amazonaws.com/prod";

// Mostrar vista previa de la imagen
imageInput.addEventListener('change', function () {
    const file = this.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            previewImage.src = e.target.result;
            previewImage.style.display = 'block';
        }
        reader.readAsDataURL(file);
    }
});

form.addEventListener('submit', async function (e) {
    e.preventDefault();

    const ownerName = document.getElementById('ownerName').value;
    const petName = document.getElementById('petName').value;
    const petAge = document.getElementById('petAge').value;
    const file = imageInput.files[0];

    if (!ownerName || !petName || !petAge || !file) {
        alert("Please fill all fields and select an image.");
        return;
    }

    try {
        // 1. Obtener lista de dueños para generar ID
        const ownersResponse = await fetch(`${apiBaseUrl}/owners`);
        const ownersData = await ownersResponse.json();
        const ownerid = ownersResponse.ok
            ? (100 + (Array.isArray(ownersData.owners) ? ownersData.owners.length : 0)).toString()
            : '101';

        // 2. Solicitar URL pre-firmada y registrar datos base en DynamoDB
        const saveResponse = await fetch(`${apiBaseUrl}/owner`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ownerid,
                ownername: ownerName,
                petname: petName,
                age: petAge,
                fileName: file.name,
                fileType: file.type
            })
        });

        if (!saveResponse.ok) throw new Error("Failed to get pre-signed URL");

        const { uploadUrl, fileUrl } = await saveResponse.json();

        // 3. Subir la imagen a S3 usando la URL pre-firmada
        const uploadResponse = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type },
            body: file
        });
        if (!uploadResponse.ok) throw new Error("Upload to S3 failed");

        // 4. Actualizar DynamoDB con la URL de la imagen
        const finalSaveResponse = await fetch(`${apiBaseUrl}/owner`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ownerId: ownerid,
                updateKey: "imageUrl",
                updateValue: fileUrl
            })
        });

        if (!finalSaveResponse.ok) throw new Error("Failed to update image URL in DB");

        alert("Pet registered successfully!");
        form.reset();
        previewImage.style.display = 'none';

        // 5. Mostrar el registro en la galería
        const card = document.createElement('div');
        card.classList.add('photo-card');
        card.innerHTML = `
            <img src="${fileUrl}" alt="Pet image">
            <p><strong>Owner:</strong> ${ownerName}</p>
            <p><strong>Name:</strong> ${petName}</p>
            <p><strong>Age:</strong> ${petAge}</p>
        `;
        gallery.prepend(card);

    } catch (error) {
        console.error("Error:", error);
        alert("An error occurred. Check console for details.");
    }
});
