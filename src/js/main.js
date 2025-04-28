// Import the factory function AS A DEFAULT export
// Path is relative from src/js/main.js to build/wasm_build/primekit.js
import primekitModuleFactory from '../../build/wasm_build/primekit.js';

// --- Constants ---
const FILTER_DEBOUNCE_DELAY = 250; // ms (Keep for potential future use, but not active)
const CACHE_EXPIRY_MS = 60 * 60 * 1000; // 1 hour cache

// --- DOM Elements ---
const segmentSelect = document.getElementById('segment-select');
const mainContentDiv = document.getElementById('main-content');
const statusDiv = document.getElementById('status');
const resultsListElement = document.getElementById('results-list');
const resultsCountDiv = document.getElementById('results-count');
const wasmOutputDiv = document.getElementById('wasm-output');
const wasmConsolePre = document.getElementById('wasm-console');
// Filter group elements for easier access
const colorFilterGroup = document.getElementById('color-filter-group');
const sizeFilterSelect = document.getElementById('filter-size');
const materialFilterGroup = document.getElementById('material-filter-group');
const skuSearchInput = document.getElementById('sku-search-input');
const skuSearchButton = document.getElementById('sku-search-button');
const clearSearchButton = document.getElementById('clear-search-button');
const applyFilterButton = document.getElementById('apply-filter-button'); // Added

// --- Global State ---
let primeKitModule = null;          // Initialized WASM module instance (from factory)
let primeKitInstance = null;        // Instance of the C++ PrimeKit class for the current segment
let currentSegmentId = null;        // e.g., "BrandA"
let currentPrimesData = null;       // Parsed primes.json { attribute_to_prime: { ... } }
let currentInventoryData = null;    // Parsed inventory.json for SKU search fallback
let currentMatchingResults = [];    // Array of {id, sfi} from C++ filter
let currentSegmentTotalCount = 0;
let filterDebounceTimeout = null; // Keep variable, but logic removed
let scrollDebounceTimeout = null;
const segmentCache = new Map();     // Cache: segmentId -> { inventoryString, primesString, parsedPrimes, timestamp }
let isSkuSearchActive = false; // Flag for SKU search mode

// --- Core Functions ---

/**
 * Updates the status message display.
 */
function updateStatus(message, isError = false, durationMs = null) {
    console.log("Status:", message);
    if (isError) console.error("Error Status:", message);

    let displayMessage = message;
    if (durationMs !== null) {
        displayMessage += ` (Filter Time: ${durationMs.toFixed(1)}ms)`;
    }

    if (statusDiv) {
        statusDiv.textContent = displayMessage;
        statusDiv.style.color = isError ? 'red' : '#555';
    }
    if (wasmOutputDiv) {
        wasmOutputDiv.style.display = isError ? 'block' : (wasmConsolePre && wasmConsolePre.textContent ? 'block' : 'none');
    }
}

/**
 * Fetches JSON or Text data from a URL.
 */
async function fetchData(url, asText = false) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} for ${url}`);
        }
        return asText ? await response.text() : await response.json();
    } catch (error) {
        console.error(`Failed to fetch ${url}:`, error);
        updateStatus(`Error: Failed to load data file ${url}. See console.`, true);
        throw error; // Re-throw
    }
}

/**
 * Updates filter control values based on loaded segment data.
 */
function updateFilterControls(primesData) {
    console.log("Updating filter controls (single map)..." );
    const attrPrimes = primesData?.attribute_to_prime || {}; // Single source

    // --- Colors ---
    if (colorFilterGroup) {
        const colorPrimeMap = attrPrimes.color || {};
        colorFilterGroup.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            const name = cb.dataset.name;
            const prime = colorPrimeMap[name];
            cb.disabled = false; // Re-enable first
            cb.checked = (name === "Any Color"); // Default check state
            if (name === "Any Color") {
                cb.value = "1";
            } else if (prime !== undefined) {
                cb.value = String(prime);
            } else {
                cb.value = "1"; // Fallback
                cb.disabled = true;
                console.warn(`Prime missing for color: ${name}`);
            }
        });
    }

    // --- Sizes ---
    if (sizeFilterSelect) {
        const sizePrimeMap = attrPrimes.size || {};
        sizeFilterSelect.querySelectorAll('option').forEach(opt => {
             const name = opt.dataset.name;
             const prime = sizePrimeMap[name];
            opt.disabled = false; // Re-enable
            if (name === "Any Size") {
                opt.value = "1";
            } else if (prime !== undefined) {
                opt.value = String(prime);
            } else {
                opt.value = "1"; // Fallback
                opt.disabled = true;
                console.warn(`Prime missing for size: ${name}`);
            }
        });
        sizeFilterSelect.value = "1"; // Default select
    }

    // --- Materials ---
    if (materialFilterGroup) {
        const materialPrimeMap = attrPrimes.material || {};
        materialFilterGroup.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            const name = cb.dataset.name;
            const prime = materialPrimeMap[name];
            cb.disabled = false; // Re-enable
            cb.checked = (name === "Any Material"); // Default check state
            if (name === "Any Material") {
                cb.value = "1";
            } else if (prime !== undefined) {
                cb.value = String(prime);
            } else {
                cb.value = "1"; // Fallback
                cb.disabled = true;
                console.warn(`Prime missing for material: ${name}`);
            }
        });
    }
}

/**
 * Loads data for a selected brand segment, initializes WASM instance.
 */
async function loadSegment(segmentId) {
    currentSegmentId = segmentId;

    if (!segmentId) {
        mainContentDiv.style.display = 'none';
        updateStatus("Select a brand segment to begin...");
        primeKitInstance?.delete();
        primeKitInstance = null;
        currentInventoryData = null;
        currentPrimesData = null;
        currentMatchingResults = [];
        resultsListElement.innerHTML = '';
        resultsCountDiv.textContent = 'Total items: 0 | Matching: 0';
        return;
    }

    updateStatus(`Loading segment: ${segmentId}...`);
    mainContentDiv.style.display = 'none';
    resultsListElement.innerHTML = '';
    resultsCountDiv.textContent = 'Loading...';

    try {
        let inventoryString, primesString, parsedPrimes, parsedInventory;
        const now = Date.now();
        const cached = segmentCache.get(segmentId);

        if (cached && (now - cached.timestamp < CACHE_EXPIRY_MS)) {
            updateStatus(`Using cached data for ${segmentId}...`);
            inventoryString = cached.inventoryString;
            primesString = cached.primesString;
            parsedPrimes = cached.parsedPrimes;
            parsedInventory = JSON.parse(inventoryString); // Still need to parse inventory for display
        } else {
            updateStatus(`Fetching data for ${segmentId}...`);
            const inventoryPath = `/data/segments/${segmentId}/inventory.json`;
            const primesPath = `/data/segments/${segmentId}/primes.json`;
            console.log(`Fetching: ${inventoryPath}`);
            console.log(`Fetching: ${primesPath}`);

            // Fetch as text first
            [primesString, inventoryString] = await Promise.all([
                fetchData(primesPath, true),
                fetchData(inventoryPath, true)
            ]);

            // Parse for JS use
            parsedPrimes = JSON.parse(primesString);
            parsedInventory = JSON.parse(inventoryString);

            // Update cache
            segmentCache.set(segmentId, { inventoryString, primesString, parsedPrimes, timestamp: now });
        }

        // Assign to global state AFTER fetching/parsing is complete
        currentInventoryData = parsedInventory;
        currentPrimesData = parsedPrimes;
        currentSegmentTotalCount = currentInventoryData.length;

        // Update filter controls with the loaded primes
        updateFilterControls(currentPrimesData);

        // --- Initialize WASM Instance ---
        updateStatus(`Initializing WASM for ${segmentId}...`);
        if (!primeKitModule) throw new Error("WASM module failed to load.");

        primeKitInstance?.delete(); // Delete previous instance
        primeKitInstance = new primeKitModule.PrimeKit();
        console.log("Created new PrimeKit instance.");

        // Initialize C++ side
        primeKitInstance.initializePrimesFromJson(primesString); // Pass raw primes string
        primeKitInstance.initializeFromJson(inventoryString);    // Pass raw inventory string

        updateStatus(`Segment ${segmentId} ready. Filters live.`);
        mainContentDiv.style.display = 'block';

        // Attach listeners (will remove previous if any)
        setupFilterListeners();

        // Run initial filter
        handleFilter();

    } catch (error) {
        updateStatus(`Error loading segment ${segmentId}: ${error.message}`, true);
        console.error(`Error loading segment ${segmentId}:`, error);
        mainContentDiv.style.display = 'none';
        primeKitInstance?.delete();
        primeKitInstance = null;
        currentInventoryData = null;
        currentPrimesData = null;
    }
}

/**
 * Attaches essential event listeners.
 */
function setupFilterListeners() {
    // REMOVED debounced filter listeners for individual controls
    // colorFilterGroup?.querySelectorAll('input').forEach(el => el.removeEventListener('change', applyDebouncedFilter));
    // sizeFilterSelect?.removeEventListener('change', applyDebouncedFilter);
    // materialFilterGroup?.querySelectorAll('input').forEach(el => el.removeEventListener('change', applyDebouncedFilter));

    // Add listener for the Apply Filter button
    applyFilterButton?.removeEventListener('click', handleFilter);
    applyFilterButton?.addEventListener('click', handleFilter);

    // SKU Search listeners remain (should be attached only once in main)
    // skuSearchButton?.removeEventListener('click', handleSkuSearch);
    // skuSearchButton?.addEventListener('click', handleSkuSearch);
    // skuSearchInput?.removeEventListener('keypress', handleSkuSearchEnter);
    // skuSearchInput?.addEventListener('keypress', handleSkuSearchEnter);
    // clearSearchButton?.removeEventListener('click', clearSkuSearch);
    // clearSearchButton?.addEventListener('click', clearSkuSearch);

    console.log("Apply button listener attached.");
}

// Helper for SKU search Enter key
function handleSkuSearchEnter(e) {
    if (e.key === 'Enter') {
        handleSkuSearch();
    }
}

/**
 * Calculates query SFI, calls WASM, sorts by SFI, displays simple results.
 */
function handleFilter() {
    if (!primeKitInstance || !currentInventoryData || !currentPrimesData) {
        updateStatus("Not ready to filter (WASM or data missing).", true);
        return;
    }
    isSkuSearchActive = false;
    skuSearchInput.value = '';
    
    updateStatus("Applying filters...");
    const startTime = performance.now();
    performance.mark('handleFilter-start');

    // --- Calculate Single Query SFI ---
    let querySfi = 1n;

    // Colors 
    let colorSelected = false;
    colorFilterGroup?.querySelectorAll('input[name="color-filter"]:checked').forEach(cb => {
        const prime = BigInt(cb.value);
        if (prime > 1n) {
            querySfi *= prime;
            colorSelected = true;
        } else if (cb.dataset.name === "Any Color") {
            colorSelected = true; 
        }
    });
    if (!colorSelected) { /* Default to 1 */} 

    // Size
    if (sizeFilterSelect) {
        const sizePrime = BigInt(sizeFilterSelect.value);
        if (sizePrime > 1n) querySfi *= sizePrime;
    }

    // Materials
    let materialSelected = false;
    materialFilterGroup?.querySelectorAll('input[name="material-filter"]:checked').forEach(cb => {
        const prime = BigInt(cb.value);
        if (prime > 1n) {
            querySfi *= prime;
            materialSelected = true;
        } else if (cb.dataset.name === "Any Material") {
            materialSelected = true;
        }
    });
     if (!materialSelected) { /* Default to 1 */}

    // --- Check for Overflow ---
    const maxUint64 = (1n << 64n) - 1n;
    if (querySfi > maxUint64) {
        updateStatus("Error: Filter query SFI exceeds 64-bit limit.", true);
        console.error("Query SFI overflow:", { querySfi });
        resultsListElement.textContent = 'Error: Filter query too large.';
        resultsCountDiv.textContent = `Total items: ${currentSegmentTotalCount} | Matching: Error`;
        return;
    }
    const querySfiNum = Number(querySfi);

    // --- Call WASM --- 
    console.log(`Performing filter: querySfi=${querySfiNum}`);
    performance.mark('wasmFilter-start');
    let wasmResultVector;
    let results = []; // Array of {id, sfi}
    try {
        wasmResultVector = primeKitInstance.perform_filter(querySfiNum); // Pass single query SFI
        for (let i = 0; i < wasmResultVector.size(); ++i) {
            const res = wasmResultVector.get(i);
            results.push({ id: res.id, sfi: res.sfi }); // Store id and sfi
        }
    } catch (e) {
        updateStatus(`Error during filtering: ${e.message}`, true);
        console.error("WASM filter error:", e);
        return;
    } finally {
        wasmResultVector?.delete();
    }
    performance.mark('wasmFilter-end');
    performance.measure('wasmFilter-duration', 'wasmFilter-start', 'wasmFilter-end');
    const wasmDuration = performance.getEntriesByName('wasmFilter-duration').pop()?.duration || 0;
    console.log(`WASM filter took ${wasmDuration.toFixed(1)}ms. Found ${results.length} items.`);

    // --- Sort by SFI (numerical value, ascending) --- 
    performance.mark('sort-start');
    // Convert BigInt SFIs from C++ (potentially) to Numbers for reliable JS sort
    results.forEach(r => { r.sfi = Number(r.sfi); }); 
    results.sort((a, b) => a.sfi - b.sfi);
    performance.mark('sort-end');
    performance.measure('sort-duration', 'sort-start', 'sort-end');
    const sortDuration = performance.getEntriesByName('sort-duration').pop()?.duration || 0;
    console.log(`JS SFI Sort took ${sortDuration.toFixed(1)}ms`);

    // --- Display Results ---
    displayResults(results); // Pass sorted results

    performance.mark('handleFilter-end');
    performance.measure('handleFilter-duration', 'handleFilter-start', 'handleFilter-end');
    const totalDuration = performance.getEntriesByName('handleFilter-duration').pop()?.duration || 0;
    console.log(`Total handleFilter took ${totalDuration.toFixed(1)}ms`);

    updateStatus(`Displayed ${results.length} matching SKUs (sorted by SFI).`, false, totalDuration);
}

/**
 * Handles searching for a specific SKU ID.
 */
function handleSkuSearch() {
    const targetId = skuSearchInput.value.trim();
    if (!targetId) {
        clearSkuSearch();
        return;
    }
    if (!currentInventoryData || !primeKitInstance) {
        updateStatus("Please load a brand segment before searching.", true);
        return;
    }
    
    console.log(`Searching for SKU: ${targetId}`);
    isSkuSearchActive = true;
    updateStatus(`Searching for ${targetId}...`);

    const foundItem = currentInventoryData.find(item => item.id === targetId);

    if (foundItem) {
        // Display simplified format for search result
        const resultForDisplay = [{
            id: foundItem.id,
            sfi: 'N/A' // SFI not readily available from inventory data alone
        }];
        displayResults(resultForDisplay);
        updateStatus(`Displaying search result for ${targetId}.`);
    } else {
        displayResults([]); // Clear results list
        updateStatus(`SKU ${targetId} not found in the current segment.`, true);
    }
}

/**
 * Clears the SKU search and shows empty results (user needs to apply filters again).
 */
function clearSkuSearch() {
    console.log("Clearing SKU search.");
    skuSearchInput.value = '';
    isSkuSearchActive = false;
    displayResults([]); // Show empty results, wait for Apply Filter
    updateStatus("Search cleared. Apply filters to see results.");
}

/**
 * Renders the simple results format: [Brand, SKU, SFI]
 */
function renderSimpleResults(resultsToRender) {
    if (!resultsListElement || !currentSegmentId) return;
    resultsListElement.textContent = resultsToRender
        .map(result => `[${currentSegmentId}, ${result.id}, ${result.sfi}]`) // Use .sfi
        .join('\n'); 
}

/**
 * Updates display with simple results.
 */
function displayResults(resultsToDisplay) { 
    if (!resultsListElement) return;
    currentMatchingResults = resultsToDisplay; // Store results
    const matchingCount = currentMatchingResults.length;
    
    resultsCountDiv.textContent = `Total items in segment: ${currentSegmentTotalCount} | Matching: ${matchingCount}`;
    
    renderSimpleResults(resultsToDisplay); 
}

/**
 * Initializes the application.
 */
async function main() {
    console.log("PrimeRetail Initializing (Simple Internal Tool)...");
    updateStatus("Initializing UI...");

    // --- Populate Segment Selector ---
    const segments = { // Should match brands in generate_inventory.py
        "BrandA": "BrandA",
        "BrandB": "BrandB",
        "BrandC": "BrandC",
    };
    if (segmentSelect) {
        Object.entries(segments).forEach(([id, name]) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = name;
            segmentSelect.appendChild(option);
        });
        segmentSelect.addEventListener('change', (event) => loadSegment(event.target.value));
    } else {
        updateStatus("Error: Segment selector UI element missing.", true);
        return;
    }

    // --- Initialize WASM Module ---
    updateStatus("Loading WASM module...");
    try {
        primeKitModule = await primekitModuleFactory({
            print: (text) => console.log('[WASM]', text), // Basic logging
            printErr: (text) => console.error('[WASM Err]', text),
            // Provide overrides for WASM console display if needed
            // print: (text) => { /* ... update wasmConsolePre ... */ },
            // printErr: (text) => { /* ... update wasmConsolePre ... */ },
        });
        updateStatus("WASM Module Loaded. Select a brand segment.");
        console.log("WASM Module instance created:", primeKitModule);
    } catch (error) {
        console.error("Failed to initialize WASM module:", error);
        updateStatus("Error: Failed to load WASM module. See console.", true);
        if (segmentSelect) segmentSelect.disabled = true;
        return;
    }

    // --- Add Core Event Listeners ---
    setupFilterListeners(); // Attaches Apply button listener

    if (skuSearchButton) {
        skuSearchButton.addEventListener('click', handleSkuSearch);
    }
    if (skuSearchInput) {
        skuSearchInput.addEventListener('keypress', handleSkuSearchEnter); // Use helper
    }
    if (clearSearchButton) {
        clearSearchButton.addEventListener('click', clearSkuSearch);
    }

    updateStatus("Select a brand segment to begin...");
    console.log("PrimeRetail Initialized. Waiting for segment selection.");
}

// --- Run ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main();
} 