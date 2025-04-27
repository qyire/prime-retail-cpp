// Import the Emscripten-generated module. Relies on Module object defined in HTML.
import primekitFactory from '../../wasm_build/primekit.js';

// DOM Elements
const statusElement = document.getElementById('status');
const resultsCountElement = document.getElementById('results-count');
const resultsListElement = document.getElementById('results-list');
const filterButton = document.getElementById('filter-button');
const colorSelect = document.getElementById('filter-color');
const sizeSelect = document.getElementById('filter-size');
const materialSelect = document.getElementById('filter-material');

// --- Global State ---
let primeKitInstance = null; // Holds the instantiated C++ PrimeKit object
let Module = window.Module; // Get the Module object from the global scope (defined in HTML)
let inventoryData = []; // Holds the raw inventory from JSON
let masterPrimes = {}; // Holds master prime definitions { attr: { value: prime } }
let localPrimes = {}; // Holds local prime definitions { attr: { value: prime } }
let totalItemCount = 0;

// --- Utility Functions ---

// Helper to fetch JSON data
async function fetchJson(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} for ${url}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Failed to fetch ${url}:`, error);
        Module.setStatus(`Error: Failed to load data file ${url}. See console.`);
        throw error; // Re-throw to stop initialization
    }
}

// Helper to safely get a prime number from loaded definitions
function getPrime(primeDict, attributeKey, attributeValue) {
    return primeDict[attributeKey]?.[attributeValue] || 1;
}

// Calculates SFI in JavaScript based on attributes and relevant keys/primes
function calculateSfi(attributes, relevantKeys, primeDict) {
    let sfi = 1n; // Use BigInt for calculations to avoid JS number limits
    for (const key of relevantKeys) {
        const value = attributes[key];
        if (value) {
            const prime = BigInt(getPrime(primeDict, key, value));
            if (prime > 1n) {
                sfi *= prime;
            }
        }
    }
    // Check if SFI exceeds uint64_t max before returning
    // WASM expects number, not BigInt. Throw error if too large.
    const maxUint64 = (1n << 64n) - 1n;
    if (sfi > maxUint64) {
        console.error(`SFI calculation overflow for item! SFI: ${sfi}, Attributes:`, attributes);
        // Return 1 for the C++ side to indicate an error/invalid SFI
        // Consistent with the C++ overflow handling.
        return 1;
    }
    return Number(sfi); // Convert back to Number for WASM
}

// --- Initialization ---

async function initializeApp() {
    try {
        Module.setStatus('Loading data files...');
        // Fetch primes and inventory in parallel
        const [masterPrimeData, localPrimeData, rawInventory] = await Promise.all([
            fetchJson('../data/primes_master.json'),
            fetchJson('../data/primes_local_example.json'),
            fetchJson('../data/inventory.json')
        ]);

        masterPrimes = masterPrimeData.attribute_to_prime;
        localPrimes = localPrimeData.attribute_to_prime;
        inventoryData = rawInventory;
        totalItemCount = inventoryData.length;
        resultsCountElement.textContent = `Total items: ${totalItemCount} | Matching: 0`;

        Module.setStatus('Initializing WASM module...');
        const loadedModule = await primekitFactory(Module); // Pass the Module object
        Module = loadedModule; // Update Module reference
        Module.setStatus('WASM Module Initialized.');

        // Instantiate the PrimeKit class
        primeKitInstance = new Module.PrimeKit();
        console.log('PrimeKit WASM instance created.');

        Module.setStatus('Processing inventory and sending to WASM...');
        // Process inventory: Calculate SFIs and create data structure for C++
        const skuDataForWasm = new Module.VectorSkuData();
        const masterKeys = Object.keys(masterPrimes);
        const localKeys = Object.keys(localPrimes);

        for (const item of inventoryData) {
            const masterSfi = calculateSfi(item.attributes, masterKeys, masterPrimes);
            const localSfi = calculateSfi(item.attributes, localKeys, localPrimes);

            // Add to the vector that will be passed to C++
            skuDataForWasm.push_back({
                sku_id: item.id,
                master_sfi: masterSfi,
                local_sfi: localSfi
            });
        }

        // Initialize C++ side with the processed data
        primeKitInstance.initializeData(skuDataForWasm);
        skuDataForWasm.delete(); // Clean up the JS-side vector wrapper

        Module.setStatus('Ready to filter.');
        filterButton.disabled = false; // Enable the button
        // Perform initial filter (show all items)
        applyFilters(); 

    } catch (error) {
        console.error("Initialization failed:", error);
        Module.setStatus(`Error during initialization: ${error.message}. Check console.`);
        filterButton.disabled = true; // Keep button disabled on error
    }
}

// --- Filtering Logic ---

function applyFilters() {
    if (!primeKitInstance) {
        console.error("WASM module not ready.");
        return;
    }

    // Calculate query SFIs based on dropdown selections
    // Value 1 means 'Any'
    const masterQuery = BigInt(colorSelect.value); // Color is the only master attr

    // Local attributes are combined
    const localQuery = BigInt(sizeSelect.value) * BigInt(materialSelect.value);

    console.log(`JS: Calculating filter. Master: ${masterQuery}, Local Size: ${sizeSelect.value}, Local Material: ${materialSelect.value} -> Local Query: ${localQuery}`);

    // Pass query SFIs to WASM (convert BigInt back to Number)
    // Check for overflow before converting to Number
    const maxUint64 = (1n << 64n) - 1n;
    if (masterQuery > maxUint64 || localQuery > maxUint64) {
        console.error("Query SFI overflow! Cannot filter.");
        Module.setStatus("Error: Query SFI too large.");
        resultsListElement.innerHTML = '<li>Error: Query SFI overflow</li>';
        resultsCountElement.textContent = `Total items: ${totalItemCount} | Matching: Error`;
        return;
    }
    
    Module.setStatus('Filtering...');
    const startTime = performance.now();

    const matchingIdsVector = primeKitInstance.performFilter(Number(masterQuery), Number(localQuery));
    
    const endTime = performance.now();
    Module.setStatus(`Filtering complete in ${(endTime - startTime).toFixed(2)} ms.`);

    // Process results from WASM
    const matchingIds = [];
    for (let i = 0; i < matchingIdsVector.size(); ++i) {
        matchingIds.push(matchingIdsVector.get(i));
    }
    matchingIdsVector.delete(); // Clean up the result vector wrapper

    // Display results
    displayResults(matchingIds);
}

// --- UI Update ---

function displayResults(matchingIds) {
    resultsListElement.innerHTML = ''; // Clear previous results
    if (matchingIds.length === 0) {
        resultsListElement.innerHTML = '<li>No matching products found.</li>';
    } else {
        // Find the full product data for matching IDs (can be optimized)
        const matchingProducts = inventoryData.filter(item => matchingIds.includes(item.id));
        matchingProducts.forEach(item => {
            const li = document.createElement('li');
            li.textContent = `${item.id}: ${item.name} (Color: ${item.attributes.color}, Size: ${item.attributes.size}, Material: ${item.attributes.material})`;
            resultsListElement.appendChild(li);
        });
    }
    resultsCountElement.textContent = `Total items: ${totalItemCount} | Matching: ${matchingIds.length}`;
}

// --- Event Listeners ---

filterButton.addEventListener('click', applyFilters);
// Optional: Add listeners to dropdowns to filter on change
// colorSelect.addEventListener('change', applyFilters);
// sizeSelect.addEventListener('change', applyFilters);
// materialSelect.addEventListener('change', applyFilters);

// --- Start the Application ---
initializeApp(); 