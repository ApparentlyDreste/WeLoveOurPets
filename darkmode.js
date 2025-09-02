// --- Dark mode pain in the ahhh -- 

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

// --- FUNCIONES IMAGE SIZING ---
function resizeImageToDataURL(file, width, height, callback) {
  const reader = new FileReader();
  reader.onload = function (event) {
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      const aspectRatio = img.width / img.height;
      const targetRatio = width / height;
      let srcWidth = img.width;
      let srcHeight = img.height;
      let srcX = 0;
      let srcY = 0;

      if (aspectRatio > targetRatio) {
        srcWidth = img.height * targetRatio;
        srcX = (img.width - srcWidth) / 2;
      } else {
        srcHeight = img.width / targetRatio;
        srcY = (img.height - srcHeight) / 2;
      }

      ctx.drawImage(img, srcX, srcY, srcWidth, srcHeight, 0, 0, width, height);
      const resizedDataURL = canvas.toDataURL('image/png');
      callback(resizedDataURL);
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

// --- Event to change said image  ---
imageInput.addEventListener('change', function () {
  const file = this.files[0];
  if (file) {
    resizeImageToDataURL(file, 400, 300, function (resizedURL) {
      previewImage.setAttribute('src', resizedURL);
      previewImage.style.display = 'block';
    });
  }
});

// Show how the image looks like
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
        // 1. Obtain list of owners
        const ownersResponse = await fetch(`${apiBaseUrl}/owners`);
        const ownersData = await ownersResponse.json();
        const ownerid = ownersResponse.ok
            ? (100 + (Array.isArray(ownersData.owners) ? ownersData.owners.length : 0)).toString()
            : '101';

        // 2. Pre-sign URL and register metadata in dynamodb
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

        // 3. Upload image to s3 using the presign url
        const uploadResponse = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": file.type },
            body: file
        });
        if (!uploadResponse.ok) throw new Error("Upload to S3 failed");

        // 4. Update dynamodb table with the info of the presign url
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

async function updateImageUrl(ownerid, fileUrl) {
    try {
        const response = await fetch(apiBaseUrl + '/owner', {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ownerId: ownerid,
                updateKey: 'imageUrl',
                updateValue: fileUrl
            })
        });
        const data = await response.json();
        if (!response.ok || data.Message !== 'SUCCESS') {
            throw new Error('Failed to update image URL in DB');
        }
        console.log('Image URL updated:', data);
    } catch (error) {
        console.error('Error:', error);
    }
}

