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

const MAX_ACCEPTABLE_ACCURACY = 50;
const MIN_READINGS = 3;
const TARGET_READINGS = 5;
const MAX_WAIT_TIME = 45000;
const MIN_COLLECTION_TIME = 12000;

function getRepresentativePosition(positions) {
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

function getMedian(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
        return (sorted[middle - 1] + sorted[middle]) / 2;
    }

    return sorted[middle];
}

export async function getCurrentPosition() {
    if (!navigator.geolocation) {
        throw new Error(
            'Your browser does not support location services.'
        );
    }

    return new Promise((resolve, reject) => {
        const positions = [];
        const timestamps = new Set();

        let watchId = null;
        let finished = false;
        let lastBrowserError = null;
        let rejectedReadings = 0;

        const startedAt = Date.now();

        function cleanup() {
            if (watchId !== null) {
                navigator.geolocation.clearWatch(watchId);
            }

            clearTimeout(overallTimer);
            clearTimeout(collectionTimer);
        }

        function finish(error = null) {
            if (finished) return;

            finished = true;
            cleanup();

            if (error) {
                reject(error);
                return;
            }

            if (positions.length < MIN_READINGS) {
                reject(new Error(
                    'Not enough reliable GPS readings. Move to an open area and try again.'
                ));
                return;
            }

            const representative =
                getRepresentativePosition(positions);

            if (!representative) {
                reject(new Error(
                    'Unable to determine a reliable GPS position. Please try again.'
                ));
                return;
            }

            // Account conservatively for the spread between readings.
            const distancesFromRepresentative = positions.map(position =>
                distanceMetres(
                    representative.coords.latitude,
                    representative.coords.longitude,
                    position.coords.latitude,
                    position.coords.longitude
                )
            );

            const positionSpread =
                getMedian(distancesFromRepresentative);

            const reportedAccuracy =
                representative.coords.accuracy;

            const effectiveAccuracy = Math.max(
                reportedAccuracy,
                positionSpread
            );

            if (effectiveAccuracy > MAX_ACCEPTABLE_ACCURACY) {
                reject(new Error(
                    `GPS accuracy is approximately ${Math.round(effectiveAccuracy)} metres. ` +
                    'A reading of 50 metres or better is required. Move to an open area and try again.'
                ));
                return;
            }

            resolve({
                latitude: representative.coords.latitude,
                longitude: representative.coords.longitude,
                accuracy: effectiveAccuracy
            });
        }

        function handleBrowserError(error) {
            lastBrowserError = error;

            // Permission denial is not a temporary GPS problem.
            if (error.code === 1) {
                finish(new Error(
                    'Location permission was denied. Enable location access for this website in your browser settings.'
                ));
            }

            // TIMEOUT and POSITION_UNAVAILABLE can be temporary.
            // Keep watching instead of immediately abandoning acquisition.
        }

        function getFinalError() {
            if (rejectedReadings > 0 && positions.length === 0) {
                return new Error(
                    'Your GPS readings are currently less accurate than 50 metres. ' +
                    'Move outdoors, enable precise location and try again.'
                );
            }

            if (lastBrowserError?.code === 2) {
                return new Error(
                    'Your current location is unavailable. Check your device location settings and try again.'
                );
            }

            if (lastBrowserError?.code === 3) {
                return new Error(
                    'GPS acquisition timed out. Move to an open area and try again.'
                );
            }

            return new Error(
                'Unable to obtain enough reliable GPS readings. Check your location settings and try again.'
            );
        }

        const collectionTimer = setTimeout(() => {
            if (positions.length >= MIN_READINGS) {
                finish();
            }
        }, MIN_COLLECTION_TIME);

        const overallTimer = setTimeout(() => {
            if (positions.length >= MIN_READINGS) {
                finish();
            } else {
                finish(getFinalError());
            }
        }, MAX_WAIT_TIME);

        watchId = navigator.geolocation.watchPosition(
            position => {
                if (finished) return;

                const accuracy = position.coords.accuracy;
                const timestamp = position.timestamp;

                // Ignore invalid or stale readings.
                if (
                    !Number.isFinite(accuracy) ||
                    accuracy <= 0 ||
                    !Number.isFinite(timestamp) ||
                    Date.now() - timestamp > 15000
                ) {
                    return;
                }

                // Ignore duplicate readings.
                if (timestamps.has(timestamp)) {
                    return;
                }

                timestamps.add(timestamp);

                // Keep the existing backend's 50m accuracy requirement.
                if (accuracy > MAX_ACCEPTABLE_ACCURACY) {
                    rejectedReadings++;
                    return;
                }

                positions.push(position);

                const elapsed = Date.now() - startedAt;

                // Collect several readings instead of trusting one reading.
                if (
                    positions.length >= TARGET_READINGS &&
                    elapsed >= MIN_COLLECTION_TIME
                ) {
                    finish();
                }
            },

            handleBrowserError,

            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: MAX_WAIT_TIME
            }
        );
    });
}