# PrimeRetail SFI Filtering Demo

A lightweight web application demonstrating high-performance client-side SKU filtering using C++, WebAssembly (WASM), and JavaScript. It leverages Square-Free Integer (SFI) encoding based on prime numbers for efficient attribute filtering within specific brand segments.

## Core Concept

- **Attribute Primes:** Within each brand's data, relevant attribute values (color, size, material) are mapped to unique prime numbers.
- **SKU SFI:** Each SKU is assigned a single SFI, calculated as the product of its attribute primes.
- **Filtering:** User selections generate a query SFI. The WASM module efficiently finds matching SKUs by checking if `sku_sfi % query_sfi == 0`.

This repository showcases the core SFI algorithm implementation compiled to WASM for browser execution.
