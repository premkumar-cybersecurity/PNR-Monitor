async function checkPNR(pnrNumber) {
  if (process.env.PNR_PROVIDER_ENABLED !== "true") {
    throw new Error("PNR provider is disabled.");
  }

  const baseUrl = process.env.PNR_API_URL || "https://api.apimitra.in/train/pnr";
  const separator = baseUrl.includes("?") ? "&" : "?";
  const url = `${baseUrl}${separator}number=${encodeURIComponent(pnrNumber)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-api-key": process.env.PNR_API_KEY
    }
  });

  if (!response.ok) {
    throw new Error(`PNR provider returned HTTP ${response.status}`);
  }

  const data = await response.json();

  if (data.status !== "ok") {
    throw new Error("PNR provider did not return a successful response.");
  }

  if (!data.passengers || data.passengers.length === 0) {
    throw new Error("No passenger status was returned for this PNR.");
  }

  const currentStatus = data.passengers
    .map((passenger) => `P${passenger.number}: ${passenger.current_status}`)
    .join(" | ");

  return {
    pnrNumber: data.pnr,
    trainNumber: data.train_number || null,
    trainName: data.train_name || null,
    journeyDate: convertDate(data.travel_date),
    currentStatus
  };
}

function convertDate(dateString) {
  if (!dateString) return null;

  const parts = dateString.split("-");
  if (parts.length !== 3) return null;

  const [day, month, year] = parts;
  return `${year}-${month}-${day}`;
}

module.exports = { checkPNR };
