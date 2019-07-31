'use strict';

const {setState} = require('../../util/Accessory');
const {addCurrentStateCharacteristic, addTargetStateCharacteristic} = require('./CurrentTarget');

const CURRENT_TARGET_POSITION_CONFIG = {
    item: "item",
    inverted: "inverted",
    multiplier: "multiplier",
    stateItem: "stateItem",
    stateItemInverted: "stateItemInverted",
    stateItemMultiplier: "stateItemMultiplier",
    manuMode: "manuMode"
};

function addCurrentPositionCharacteristic(service) {
    let item, itemType, inverted, multiplier;
    let manuMode = this._checkInvertedConf(CURRENT_TARGET_POSITION_CONFIG.manuMode);
    if(this._config[CURRENT_TARGET_POSITION_CONFIG.stateItem]) {
        [item, itemType] = this._getAndCheckItemType(CURRENT_TARGET_POSITION_CONFIG.stateItem, ['Rollershutter', 'Number', 'Switch', 'Dimmer', 'Contact']);
        inverted = this._checkInvertedConf(CURRENT_TARGET_POSITION_CONFIG.stateItemInverted);
        multiplier = this._checkMultiplierConf(CURRENT_TARGET_POSITION_CONFIG.stateItemMultiplier, itemType);
    } else {
        [item, itemType] = this._getAndCheckItemType(CURRENT_TARGET_POSITION_CONFIG.item, ['Rollershutter', 'Number', 'Switch', 'Dimmer']);
        inverted = this._checkInvertedConf(CURRENT_TARGET_POSITION_CONFIG.inverted);
        multiplier = this._checkMultiplierConf(CURRENT_TARGET_POSITION_CONFIG.multiplier, itemType);
    }

    let targetCharacteristic = manuMode ? service.getCharacteristic(this.Characteristic.TargetPosition) : null;

    addCurrentStateCharacteristic.bind(this)(service.getCharacteristic(this.Characteristic.CurrentPosition),
        item,
        itemType,
        inverted,
        positionTransformation.bind(this,
            multiplier,
            service.getCharacteristic(this.Characteristic.TargetPosition)
        ),
        targetCharacteristic
    );
}

function addTargetPositionCharacteristic(service) {
    let [item, itemType] = this._getAndCheckItemType(CURRENT_TARGET_POSITION_CONFIG.item, ['Rollershutter', 'Number', 'Switch', 'Dimmer']);
    let inverted = this._checkInvertedConf(CURRENT_TARGET_POSITION_CONFIG.inverted);
    let multiplier = this._checkMultiplierConf(CURRENT_TARGET_POSITION_CONFIG.multiplier, itemType);
    let stateItem, stateItemType, stateItemInverted, stateItemMultiplier;

    if(this._config[CURRENT_TARGET_POSITION_CONFIG.stateItem]) {
        [stateItem, stateItemType] = this._getAndCheckItemType(CURRENT_TARGET_POSITION_CONFIG.stateItem, ['Rollershutter', 'Number', 'Switch', 'Dimmer', 'Contact']);
        stateItemInverted = this._checkInvertedConf(CURRENT_TARGET_POSITION_CONFIG.stateItemInverted);
        stateItemMultiplier = this._checkMultiplierConf(CURRENT_TARGET_POSITION_CONFIG.stateItemMultiplier, stateItemType);
    } else {
        stateItem = item;
        stateItemType = itemType;
        stateItemInverted = inverted;
        stateItemMultiplier = multiplier;
    }
    // In order to know if this is the setter and apply `UP`/`DOWN` to it in case of 100 and 0
    if(itemType === 'Rollershutter') {
        itemType = `${itemType}Setter`;
    }
    addTargetStateCharacteristic.bind(this)(service.getCharacteristic(this.Characteristic.TargetPosition),
        item,
        itemType,
        inverted,
        stateItem,
        stateItemType,
        stateItemInverted,
        positionTransformation.bind(this,
            multiplier,
            null
        ),
        positionTransformation.bind(this,
            stateItemMultiplier,
            null
        )
    );
}

function addPositionStateCharacteristic(service) {
    this._log.debug(`Creating position state characteristic for ${this.name}`);

    service.getCharacteristic(this.Characteristic.PositionState) // We will just fake it, since it is not used anyway
        .on('get', function(callback) {
            callback(null, this.Characteristic.PositionState.STOPPED);
        }.bind(this));
}

function addHoldPositionCharacteristic(service) {
    try {
        let [item] = this._getAndCheckItemType(CURRENT_TARGET_POSITION_CONFIG.item, ['Rollershutter']);

        this._log.debug(`Creating hold position state characteristic for ${this.name} with item ${item}`);

        service.getCharacteristic(this.Characteristic.HoldPosition) // Never tested, since I don't know how to invoke it
            .on('set', setState.bind(this,
                item, {
                1: "STOP",
                "_default": ""
            }));

    } catch(e) {
        this._log.debug(`Not configuring hold position characteristic for ${this.name}: ${e.message}`);
        service.removeCharacteristic(this.Characteristic.HoldPosition);
    }
}

function positionTransformation(multiplier, targetStateCharacteristic, type, inverted, value) {
    let transformedValue;

    let onCommand = type === 'Contact' ? "OPEN": "ON";
    let offCommand = type === 'Contact' ? "CLOSED": "OFF";

    switch(type) {
        case 'Contact':
        case 'Switch':
            if(value === onCommand) {
                transformedValue = inverted ?
                    0 :
                    100;
            } else if (value === offCommand) {
                transformedValue = inverted ?
                    100 :
                    0;
            } else {
                if(value >= 50 && !(inverted)) {
                    transformedValue = onCommand;
                } else {
                    transformedValue = offCommand;
                }
            }
            break;
        case 'RollershutterSetter':
        case 'Rollershutter':
        case 'Number':
        case 'Dimmer':            
            //This part is only invoked if this is used in a setter context and the item is a rollershutter
            if(type === 'RollershutterSetter' && value === 100) {
                transformedValue = 'UP';
            } else if(type === 'RollershutterSetter' && value === 0) {
                transformedValue = 'DOWN';
            } else {

                if (inverted) {
                    transformedValue = Math.floor(100 - (parseFloat(value) * multiplier));
                } else {
                    transformedValue = Math.floor(parseFloat(value) * multiplier);
                }
                if (transformedValue >= 99) { // Weird not showing 100 or 0 bug of openHAB
                    transformedValue = 100;
                }
                if (transformedValue <= 1) {
                    transformedValue = 0;
                }

                const threshold = 3;
                if (targetStateCharacteristic && targetStateCharacteristic.value !== transformedValue) {
                    this._log.debug(`Checking if actual state is within threshold (${threshold}) of target state`);
                    if ((targetStateCharacteristic.value > transformedValue && (targetStateCharacteristic.value - threshold) <= transformedValue) ||
                        (targetStateCharacteristic.value < transformedValue && (targetStateCharacteristic.value + threshold) >= transformedValue)) {
                        this._log.debug(`Actually assigning target state ${targetStateCharacteristic.value}, because its within the threshold (${threshold}) of the actual state ${transformedValue}`);
                        transformedValue = targetStateCharacteristic.value;
                    }
                }
            }
            break;
    }

    this._log.debug(`Transformed ${value} with inverted set to ${inverted} and multiplier set to ${multiplier} for ${this.name} (type: ${type}) to ${transformedValue}`);
    return transformedValue;
}

module.exports = {
    addCurrentPositionCharacteristic,
    addTargetPositionCharacteristic,
    addHoldPositionCharacteristic,
    addPositionStateCharacteristic
};

