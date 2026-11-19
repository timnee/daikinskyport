"""Test sensor declarations without importing Home Assistant or contacting Skyport."""

import ast
import asyncio
from pathlib import Path
from types import SimpleNamespace
import unittest


COMPONENT = Path(__file__).resolve().parents[1] / "custom_components" / "daikinskyport"


def declarations(filename, names, namespace):
    """Load selected production declarations with explicit dependency substitutes."""
    tree = ast.parse((COMPONENT / filename).read_text())
    nodes = [
        node for node in tree.body
        if getattr(node, "name", None) in names
        or (
            isinstance(node, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id in names for t in node.targets)
        )
    ]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), filename, "exec"), namespace)
    return SimpleNamespace(**namespace)


API = declarations("daikinskyport.py", {
    "INVALID_SENSOR_VALUES", "is_valid_sensor_value",
    "fahrenheit_tenths_to_celsius", "fahrenheit_difference_tenths_to_celsius",
    "DaikinSkyport",
}, {"DAIKIN_PERCENT_MULTIPLIER": 2})


class Constants:
    """Provide string constants without a Home Assistant installation."""

    def __getattr__(self, name):
        return name.lower()


SENSOR = declarations("sensor.py", {
    "SENSOR_TYPES", "DaikinSkyportSensor", "async_setup_entry",
    "DEVICE_CLASS_DEMAND", "DEVICE_CLASS_FAULT_CODE", "DEVICE_CLASS_FREQ_PERCENT",
    "DEVICE_CLASS_ACTUAL_STATUS", "DEVICE_CLASS_AIR_FLOW",
}, {
    "SensorDeviceClass": Constants(),
    "SensorStateClass": Constants(),
    "SensorEntity": object,
    "UnitOfTemperature": SimpleNamespace(CELSIUS="°C", FAHRENHEIT="°F"),
    **{name: Constants() for name in (
        "UnitOfDensity", "UnitOfPressure", "UnitOfPower", "UnitOfRatio",
        "UnitOfVolumeFlowRate",
    )},
    "PERCENTAGE": "%",
    "HomeAssistant": object, "ConfigEntry": object, "AddEntitiesCallback": object,
    "DeviceInfo": object, "DaikinSkyportData": object,
    "DOMAIN": "daikinskyport", "COORDINATOR": "coordinator",
    "is_valid_sensor_value": API.is_valid_sensor_value,
})


def client(**values):
    api = API.DaikinSkyport.__new__(API.DaikinSkyport)
    api.thermostats = [{
        "id": "test-device", "model": "test-model", "name": "Main Room",
        "tempOutdoor": 10, "humOutdoor": 50, "equipmentStatus": 5,
        "aqOutdoorAvailable": False, "aqIndoorAvailable": False, **values,
    }]
    return api


class Coordinator:
    def __init__(self, api):
        self.daikinskyport = api

    async def _async_update_data(self):
        pass


class TemperatureTests(unittest.TestCase):
    def test_absolute_and_difference_conversions_are_distinct(self):
        self.assertEqual(API.fahrenheit_tenths_to_celsius(320), 0)
        self.assertEqual(API.fahrenheit_difference_tenths_to_celsius(320), 17.8)
        self.assertEqual(API.fahrenheit_difference_tenths_to_celsius(0), 0)

    def test_difference_device_class_preserves_entity_identity(self):
        coordinator = Coordinator(client())
        for name in ("Indoor superheat", "Indoor subcool"):
            sensor = SENSOR.DaikinSkyportSensor(
                coordinator, f"Main Room {name}", "temperature_difference", 0
            )
            self.assertEqual(sensor.device_class, "temperature_delta")
            self.assertEqual(sensor.native_unit_of_measurement, "°C")
            self.assertEqual(sensor.name, f"Main Room {name} temperature")
            self.assertEqual(sensor._attr_unique_id, f"test-device-Main Room {name} temperature")

    def test_absolute_temperatures_keep_their_device_class(self):
        sensor = SENSOR.DaikinSkyportSensor(
            Coordinator(client()), "Main Room Outdoor coil", "temperature", 0
        )
        self.assertEqual(sensor.device_class, "temperature")
        self.assertEqual(sensor._attr_unique_id, "test-device-Main Room Outdoor coil temperature")

    def test_refrigerant_entities_exist_without_readings(self):
        api = client(ctAHSuperHeatValue=None)
        sensors = {s["name"]: s for s in api.get_sensors(0)}
        for name in ("Indoor superheat", "Indoor subcool"):
            self.assertIsNone(sensors[f"Main Room {name}"]["value"])
            self.assertTrue(sensors[f"Main Room {name}"]["create_if_unavailable"])
        added = []
        hass = SimpleNamespace(data={"daikinskyport": {"entry": {"coordinator": Coordinator(api)}}})
        asyncio.run(SENSOR.async_setup_entry(
            hass, SimpleNamespace(entry_id="entry"), lambda entities, _: added.extend(entities)
        ))
        self.assertEqual(sum(s.device_class == "temperature_delta" for s in added), 2)

    def test_native_differences_clear_and_recover(self):
        api = client(ctAHSuperHeatValue=200, ctAHSubCoolValue=20)
        coordinator = Coordinator(api)
        for name, key, expected in (
            ("Indoor superheat", "ctAHSuperHeatValue", 20),
            ("Indoor subcool", "ctAHSubCoolValue", 2),
        ):
            sensor = SENSOR.DaikinSkyportSensor(
                coordinator, f"Main Room {name}", "temperature_difference", 0
            )
            asyncio.run(sensor.async_update())
            self.assertAlmostEqual(sensor.native_value * 1.8, expected, delta=0.1)
            previous = api.thermostats[0].pop(key)
            asyncio.run(sensor.async_update())
            self.assertIsNone(sensor.native_value)
            api.thermostats[0][key] = 65535
            asyncio.run(sensor.async_update())
            self.assertIsNone(sensor.native_value)
            api.thermostats[0][key] = previous
            asyncio.run(sensor.async_update())
            self.assertIsNotNone(sensor.native_value)


if __name__ == "__main__":
    unittest.main()
