const { faker } = require('@faker-js/faker');
const XLSX = require('xlsx');

faker.seed(42);

// Constants
const TOTAL_ENTRIES = 1000;
const WRONG_ENTRIES = 50;
const DUPLICATE_ENTRIES = 5;
const BASE_ENTRIES = TOTAL_ENTRIES - WRONG_ENTRIES - DUPLICATE_ENTRIES;

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

function generateRandomReservation(isValid = true) {
    const checkInDate = faker.date.between({
        from: new Date(2024, 0, 1),
        to: new Date(2024, 11, 31)
    });

    const checkOutDate = new Date(checkInDate);
    checkOutDate.setDate(checkOutDate.getDate() + faker.number.int({ min: 1, max: 14 }));

    const reservation = {
        reservation_id: faker.string.uuid(),
        guest_name: faker.person.fullName(),
        status: getRandomStatus(),
        check_in_date: checkInDate.toISOString().split('T')[0],
        check_out_date: checkOutDate.toISOString().split('T')[0]
    };

    if (!isValid) {
        const errorType = faker.number.int({ min: 1, max: 3 });
        switch (errorType) {
            case 1:
                reservation.guest_name = null;
                break;
            case 2:
                [reservation.check_in_date, reservation.check_out_date] =
                    [reservation.check_out_date, reservation.check_in_date];
                break;
            case 3:
                reservation.check_in_date = null;
                break;
        }
    }

    return reservation;
}

const reservations = Array.from({ length: BASE_ENTRIES }, () => generateRandomReservation(true));

const duplicates = faker.helpers.arrayElements(reservations, DUPLICATE_ENTRIES);
reservations.push(...duplicates);

const wrongEntries = Array.from({ length: WRONG_ENTRIES }, () => generateRandomReservation(false));
reservations.push(...wrongEntries);

const shuffledReservations = faker.helpers.shuffle(reservations);

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(shuffledReservations);

ws['!cols'] = [
    { wch: 40 }, // reservation_id
    { wch: 25 }, // guest_name
    { wch: 10 }, // status
    { wch: 12 }, // check_in_date
    { wch: 12 }  // check_out_date
];

XLSX.utils.book_append_sheet(wb, ws, 'Reservations');

XLSX.writeFile(wb, 'reservations.xlsx');

console.log('Successfully generated reservations.xlsx'); 