'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Sellers', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      asin: {
        type: Sequelize.STRING
      },
      sellerName: {
        type: Sequelize.STRING
      },
      soldBy: {
        type: Sequelize.STRING
      },
      price: {
        type: Sequelize.DECIMAL
      },
      condition: {
        type: Sequelize.STRING
      },
      isFBA: {
        type: Sequelize.BOOLEAN
      },
      isFBM: {
        type: Sequelize.BOOLEAN
      },
      shippingPrice: {
        type: Sequelize.DECIMAL
      },
      deliveryDateText: {
        type: Sequelize.STRING
      },
      sellerRating: {
        type: Sequelize.DECIMAL
      },
      sellerRatingCount: {
        type: Sequelize.INTEGER
      },
      positivePercentage: {
        type: Sequelize.DECIMAL
      },
      marketplace: {
        type: Sequelize.STRING
      },
      targetCountry: {
        type: Sequelize.STRING
      },
      scrapedAt: {
        type: Sequelize.DATE
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE
      }
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Sellers');
  }
};