# Prime Shipping SFI Web Application

A web application demonstrating efficient server-side shipment data filtering using Python, Flask, and JavaScript. It utilizes Square-Free Integer (SFI) encoding based on prime numbers for effective attribute filtering across large shipment datasets.

## Core Concept

- **Attribute Primes:** Shipment attributes (origin, destination, carrier, status) are mapped to unique prime numbers.
- **Shipment SFI:** Each shipment is assigned a single SFI, calculated as the product of its attribute primes.
- **Filtering:** User-defined criteria generate a query SFI. The backend efficiently finds matching shipments by checking if `shipment_sfi % query_sfi == 0`.

This repository showcases the core SFI algorithm implementation in Python, with a Flask web interface for user interaction and data visualization.
