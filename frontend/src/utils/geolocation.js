function distanceMetres(lat1, lon1, lat2, lon2) {
    const rad = value => value * Math.PI / 180;

    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(lat1)) *
        Math.cos(rad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    return 6371000 * 2 * Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1 - a)
    );
}

function getRepresentativePosition(positions) {
    // Find the position that is closest to all the other readings.
    // This is more resistant to an isolated GPS outlier than averaging.
    let bestPosition = null;
    let smallestTotalDistance = Infinity;

    for (const candidate of positions) {
        let totalDistance = 0;

        for (const other of positions) {
            totalDistance += distanceMetres(
                candidate.coords.latitude,
                candidate.coords.longitude,
                other.coords.latitude,
                other.coords.longitude
            );
        }

        if (totalDistance < smallestTotalDistance) {
            smallestTotalDistance = totalDistance;
            bestPosition = candidate;
        }
    }

    return bestPosition;
}

export async function getCurrentPosition() {
    if (!navigator.geolocation) {
        throw new Error(
            'Your browser does not support location services.'
        );
    }

    return new Promise((resolve, reject) => {
        const positions = [];
        let watchId = null;
        let finished = false;

        function finish(error = null) {
            if (finished) return;

            finished = true;

            if (watchId !== null) {
                navigator.geolocation.clearWatch(watchId);
            }

            clearTimeout(timer);

            if (error) {
                reject(error);
                return;
            }

            const representative =
                getRepresentativePosition(positions);

            resolve({
                latitude: representative.coords.latitude,
                longitude: representative.coords.longitude,
                accuracy: representative.coords.accuracy
            });
        }

        const timer = setTimeout(() => {
            if (positions.length >= 3) {
                finish();
            } else {
                finish(new Error(
                    'Unable to obtain enough reliable GPS readings. Move to an open area and try again.'
                ));
            }
        }, 25000);

        watchId = navigator.geolocation.watchPosition(
            position => {
                const accuracy = position.coords.accuracy;

                // Ignore poor-quality readings.
                if (
                    !Number.isFinite(accuracy) ||
                    accuracy > 50
                ) {
                    return;
                }

                // Ignore duplicate timestamps.
                if (
                    positions.some(
                        item => item.timestamp === position.timestamp
                    )
                ) {
                    return;
                }

                positions.push(position);

                if (positions.length >= 4) {
                    finish();
                }
            },

            error => {
                let message = 'Unable to obtain your GPS location.';

                if (error.code === 1) {
                    message = 'Location permission was denied. Please enable location access.';
                } else if (error.code === 2) {
                    message = 'Your current location is unavailable. Check your device location settings.';
                } else if (error.code === 3) {
                    message = 'GPS acquisition timed out. Move to an open area and try again.';
                }

                finish(new Error(message));
            },

            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 25000
            }
        );
    });
}