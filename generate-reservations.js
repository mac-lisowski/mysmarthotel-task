const { faker } = require('@faker-js/faker');
const XLSX = require('xlsx');

faker.seed(42);

// Constants for valid entries only
const TOTAL_ENTRIES = 1000; // Reduced for clarity

const STATUS_OPTIONS = {
    PENDING: 0.65,    // 65% chance
    CANCELED: 0.2,    // 20% chance
    COMPLETED: 0.15   // 15% chance
};

function getRandomStatus() {
    const rand = Math.random();
    let cumulative = 0;

    for (const [status, probability] of Object.entries(STATUS_OPTIONS)) {
        cumulative += probability;
        if (rand <= cumulative) return status;
    }
    return 'PENDING';
}

function generateValidReservation() {
    const checkInDate = faker.date.between({
        from: new Date(2024, 0, 1),
        to: new Date(2024, 11, 31)
    });

    const checkOutDate = new Date(checkInDate);
    checkOutDate.setDate(checkOutDate.getDate() + faker.number.int({ min: 1, max: 14 }));

    return {
        reservation_id: faker.string.uuid(),
        guest_name: faker.person.fullName(),
        status: getRandomStatus(),
        check_in_date: checkInDate.toISOString().split('T')[0],
        check_out_date: checkOutDate.toISOString().split('T')[0]
    };
}

// Generate array of unique valid reservations
const reservations = Array.from({ length: TOTAL_ENTRIES }, generateValidReservation);

// Create workbook and worksheet
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(reservations);

// Set column widths for better readability
ws['!cols'] = [
    { wch: 40 }, // reservation_id
    { wch: 25 }, // guest_name
    { wch: 10 }, // status
    { wch: 12 }, // check_in_date
    { wch: 12 }  // check_out_date
];

XLSX.utils.book_append_sheet(wb, ws, 'Reservations');

// Save as reservations-good.xlsx
XLSX.writeFile(wb, 'apps/api/test/fixtures/reservations-good.xlsx');

console.log('Successfully generated reservations-good.xlsx'); 