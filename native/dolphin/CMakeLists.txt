# Dolphin overlay plugin for the GCP-Drive folders (KDE Frameworks 6). package.sh builds it when the
# KDE development files are present; without it the folders work and show no marks in Dolphin.
cmake_minimum_required(VERSION 3.20)
project(gcpdriveoverlay LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_AUTOMOC ON)
find_package(Qt6 6.5 REQUIRED COMPONENTS Core Network)
find_package(KF6KIO REQUIRED)
add_library(gcpdriveoverlay MODULE gcpdriveoverlay.cpp)
target_link_libraries(gcpdriveoverlay PRIVATE Qt6::Core Qt6::Network KF6::KIOWidgets)
set_target_properties(gcpdriveoverlay PROPERTIES PREFIX "")
