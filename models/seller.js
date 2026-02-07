'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Seller extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  Seller.init({
    asin: DataTypes.STRING,
    sellerName: DataTypes.STRING,
    soldBy: DataTypes.STRING,
    price: DataTypes.DECIMAL,
    condition: DataTypes.STRING,
    isFBA: DataTypes.BOOLEAN,
    isFBM: DataTypes.BOOLEAN,
    shippingPrice: DataTypes.DECIMAL,
    deliveryDateText: DataTypes.STRING,
    sellerRating: DataTypes.DECIMAL,
    sellerRatingCount: DataTypes.INTEGER,
    positivePercentage: DataTypes.DECIMAL,
    marketplace: DataTypes.STRING,
    targetCountry: DataTypes.STRING,
    scrapedAt: DataTypes.DATE
  }, {
    sequelize,
    modelName: 'Seller',
  });
  return Seller;
};