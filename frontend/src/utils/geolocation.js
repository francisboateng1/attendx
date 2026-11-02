function getPosition(options) {
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            resolve,
            reject,
            options
        );
    });
}

function getLocationError(error) {
    switch (error.code) {
        case 1:
            return new Error(
                'Location permission denied. Allow location access in your browser settings and try again.'
            );

        case 2:
            return new Error(
                'Your device could not determine your location. Check GPS, enable location services and try again.'
            );

        case 3:
            return new Error(
                'Location request timed out. Move somewhere with a clearer GPS signal and try again.'
            );

        default:
            return new Error(
                'Unable to obtain your location. Check your device location settings.'
            );
    }
}

export async function getCurrentPosition() {
    if (!navigator.geolocation) {
        throw new Error(
            'This browser does not support location services.'
        );
    }

    try {
        // First attempt: high-accuracy GPS
        const position = await getPosition({
            enableHighAccuracy: true,
            timeout: 25000,
            maximumAge: 0
        });

        return {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
        };

    } catch (firstError) {

        // Permission denial cannot be fixed by retrying.
        if (firstError.code === 1) {
            throw getLocationError(firstError);
        }

        try {
            // Second attempt: alternative device/network location.
            const position = await getPosition({
                enableHighAccuracy: false,
                timeout: 20000,
                maximumAge: 60000
            });

            return {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy
            };

        } catch (secondError) {
            throw getLocationError(secondError);
        }
    }
}