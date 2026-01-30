def build_message(item):
    current = item.get("current", {})

    return (
        f"Hi Sir/Madam {item.get('clientName')},\n\n"
        f"This is from {item.get('company')} X Ol-Star Transport. Here are your vehicle service details:\n\n"

        f"✈️ FLIGHT DETAILS\n"
        f"📅 Date: {item.get('date')}\n"
        f"⏰ Pickup Time: {item.get('time')}\n"
        f"👥 Passengers: {item.get('pax')}\n\n"

        f"📍 PICKUP AREA\n"
        f"{item.get('pickup')}\n\n"

        f"📍 DROP-OFF LOCATION\n"
        f"{item.get('dropOff')}\n\n"

        f"🚗 DRIVER INFORMATION\n"
        f"Name: {current.get('driverName')}\n"
        f"Mobile: {current.get('cellPhone')}\n"
        f"Vehicle: {item.get('transportUnit')} ({item.get('unitType')})\n"
        f"Color: {item.get('color')}\n"
        f"Plate No: {item.get('plateNumber')}\n\n"

        f"🧳 CAR TYPE & LUGGAGE INFO\n"
        f"Please note that the car type you have reserved is {item.get('bookingType')}. The luggage specification allows a maximum of {item.get('luggage')} pcs (24-inch max) luggages. Hard shell suitcases and luggages with wheels cannot be placed in the passenger seating area. If the driver judges that it cannot be carried, the passenger will need to arrange for a taxi to transport the luggage.\n\n"

        f"ℹ️ ADDITIONAL INFO\n"
        f"Please note that in any applicable situation during pickup, the driver may charge additional fees, including surcharges for overtime. You have a free on (1) hour waiting period. After one (1) hour, you will be charged PHP 150 for every succeeding hour.\n\n"
        f"If any request, changes, or wrong information occur, please feel free to message us.\n\n"

        f"📞 0917-657-7693\n"
        f"📱 WhatsApp: 0963-492-2662\n"
        f"📧 olstaropc@gmail.com\n\n"

        f"This is an automated message. Please do not reply."
    )
