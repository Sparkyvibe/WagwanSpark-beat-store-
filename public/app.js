// Weather Dashboard Application
// Uses OpenWeatherMap API for free tier

const API_KEY = 'YOUR_API_KEY_HERE'; // Get free key from: https://openweathermap.org/api
const API_BASE_URL = 'https://api.openweathermap.org/data/2.5';
const GEO_API_URL = 'https://api.openweathermap.org/geo/1.0';

// DOM Elements
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const locationBtn = document.getElementById('locationBtn');
const weatherContainer = document.getElementById('weatherContainer');
const loadingSpinner = document.getElementById('loadingSpinner');
const errorMessage = document.getElementById('errorMessage');
const welcomeScreen = document.getElementById('welcomeScreen');
const quickCityButtons = document.querySelectorAll('.quick-city-btn');

// Store current coordinates
let currentCoords = null;

// Event Listeners
searchBtn.addEventListener('click', () => {
    const query = searchInput.value.trim();
    if (query) {
        searchWeather(query);
    }
});

searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const query = searchInput.value.trim();
        if (query) {
            searchWeather(query);
        }
    }
});

locationBtn.addEventListener('click', getCurrentLocation);

quickCityButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        searchWeather(btn.dataset.city);
    });
});

// Main Functions
async function searchWeather(query) {
    try {
        showLoading();
        hideError();

        // Check if query is coordinates (lat,lon)
        const coordMatch = query.match(/^([+-]?\d+\.?\d*),\s*([+-]?\d+\.?\d*)$/);
        let coords;

        if (coordMatch) {
            coords = {
                lat: parseFloat(coordMatch[1]),
                lon: parseFloat(coordMatch[2])
            };
        } else {
            // Search by city name
            coords = await getCoordinatesByCity(query);
        }

        currentCoords = coords;
        await fetchWeatherData(coords.lat, coords.lon);
    } catch (error) {
        showError(error.message);
    }
}

async function getCoordinatesByCity(cityName) {
    if (!API_KEY || API_KEY === 'YOUR_API_KEY_HERE') {
        throw new Error('Please set your OpenWeatherMap API key in app.js');
    }

    const response = await fetch(
        `${GEO_API_URL}/direct?q=${encodeURIComponent(cityName)}&limit=1&appid=${API_KEY}`
    );

    if (!response.ok) {
        throw new Error('Failed to fetch location data');
    }

    const data = await response.json();

    if (data.length === 0) {
        throw new Error(`City "${cityName}" not found. Please try another search.`);
    }

    return {
        lat: data[0].lat,
        lon: data[0].lon,
        name: data[0].name,
        country: data[0].country
    };
}

async function fetchWeatherData(lat, lon) {
    if (!API_KEY || API_KEY === 'YOUR_API_KEY_HERE') {
        throw new Error('Please set your OpenWeatherMap API key in app.js');
    }

    // Fetch current weather and forecast
    const [currentResponse, forecastResponse] = await Promise.all([
        fetch(`${API_BASE_URL}/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`),
        fetch(`${API_BASE_URL}/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric`)
    ]);

    if (!currentResponse.ok || !forecastResponse.ok) {
        throw new Error('Failed to fetch weather data');
    }

    const currentData = await currentResponse.json();
    const forecastData = await forecastResponse.json();

    displayCurrentWeather(currentData);
    displayForecast(forecastData);
    displayHourlyForecast(forecastData);

    hideLoading();
    hideWelcome();
    weatherContainer.classList.remove('hidden');
}

function displayCurrentWeather(data) {
    const { name, sys, main, weather, wind, clouds, visibility } = data;
    const iconUrl = `https://openweathermap.org/img/wn/${weather[0].icon}@4x.png`;
    const temp = Math.round(main.temp);
    const feelsLike = Math.round(main.feels_like);
    const visibilityKm = (visibility / 1000).toFixed(1);

    document.getElementById('cityName').textContent = `${name}, ${sys.country}`;
    document.getElementById('datetime').textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    document.getElementById('weatherIcon').src = iconUrl;
    document.getElementById('temperature').textContent = `${temp}°C`;
    document.getElementById('weatherDescription').textContent = 
        `${weather[0].main} (Feels like ${feelsLike}°C)`;
    document.getElementById('humidity').textContent = `${main.humidity}%`;
    document.getElementById('windSpeed').textContent = `${wind.speed.toFixed(1)} m/s`;
    document.getElementById('pressure').textContent = `${main.pressure} hPa`;
    document.getElementById('visibility').textContent = `${visibilityKm} km`;
}

function displayForecast(data) {
    const forecastContainer = document.getElementById('forecastContainer');
    forecastContainer.innerHTML = '';

    // Group forecast by day (get one forecast per day at noon)
    const dailyForecasts = {};
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    data.list.forEach(item => {
        const date = new Date(item.dt * 1000);
        date.setHours(0, 0, 0, 0);
        const dayKey = date.toISOString();

        // Take forecast closest to 12:00
        if (!dailyForecasts[dayKey] || 
            Math.abs(item.dt * 1000 - 12 * 3600 * 1000 - date.getTime()) < 
            Math.abs(dailyForecasts[dayKey].dt * 1000 - 12 * 3600 * 1000 - date.getTime())) {
            dailyForecasts[dayKey] = item;
        }
    });

    // Get next 5 days
    Object.values(dailyForecasts).slice(0, 5).forEach(item => {
        const date = new Date(item.dt * 1000);
        const iconUrl = `https://openweathermap.org/img/wn/${item.weather[0].icon}@2x.png`;
        const temp = Math.round(item.main.temp);
        const feelsLike = Math.round(item.main.feels_like);

        const forecastItem = document.createElement('div');
        forecastItem.className = 'forecast-item';
        forecastItem.innerHTML = `
            <div class="forecast-date">${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
            <img src="${iconUrl}" alt="${item.weather[0].main}" class="forecast-icon">
            <div class="forecast-temp">${temp}°C</div>
            <div class="forecast-description">${item.weather[0].main}</div>
            <div class="forecast-extra">
                Humidity: ${item.main.humidity}%
            </div>
        `;
        forecastContainer.appendChild(forecastItem);
    });
}

function displayHourlyForecast(data) {
    const hourlyContainer = document.getElementById('hourlyContainer');
    hourlyContainer.innerHTML = '';

    // Get next 24 hours (8 forecasts x 3 hours each = 24 hours)
    data.list.slice(0, 8).forEach(item => {
        const date = new Date(item.dt * 1000);
        const iconUrl = `https://openweathermap.org/img/wn/${item.weather[0].icon}@2x.png`;
        const temp = Math.round(item.main.temp);
        const windSpeed = item.wind.speed.toFixed(1);

        const hourlyItem = document.createElement('div');
        hourlyItem.className = 'hourly-item';
        hourlyItem.innerHTML = `
            <div class="hourly-time">${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
            <img src="${iconUrl}" alt="${item.weather[0].main}" class="hourly-icon">
            <div class="hourly-temp">${temp}°C</div>
            <div class="hourly-description">${item.weather[0].main}</div>
            <div class="hourly-extra">
                Wind: ${windSpeed} m/s<br>
                Humidity: ${item.main.humidity}%
            </div>
        `;
        hourlyContainer.appendChild(hourlyItem);
    });
}

function getCurrentLocation() {
    if (navigator.geolocation) {
        showLoading();
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const { latitude, longitude } = position.coords;
                currentCoords = { lat: latitude, lon: longitude };
                try {
                    await fetchWeatherData(latitude, longitude);
                } catch (error) {
                    showError(error.message);
                }
            },
            (error) => {
                hideLoading();
                showError('Unable to retrieve your location. Please search for a city instead.');
            }
        );
    } else {
        showError('Geolocation is not supported by your browser.');
    }
}

// UI Helper Functions
function showLoading() {
    loadingSpinner.classList.remove('hidden');
    weatherContainer.classList.add('hidden');
    welcomeScreen.classList.add('hidden');
}

function hideLoading() {
    loadingSpinner.classList.add('hidden');
}

function showError(message) {
    hideLoading();
    errorMessage.textContent = message;
    errorMessage.classList.remove('hidden');
}

function hideError() {
    errorMessage.classList.add('hidden');
}

function hideWelcome() {
    welcomeScreen.classList.add('hidden');
}

// Note: To use this application, you need to:
// 1. Sign up for a free account at https://openweathermap.org/api
// 2. Get your API key
// 3. Replace 'YOUR_API_KEY_HERE' with your actual API key