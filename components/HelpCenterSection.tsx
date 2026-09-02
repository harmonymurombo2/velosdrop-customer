// components/customer/HelpCenterSection.tsx
import { Feather } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export default function HelpCenterSection() {
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null);

  const faqs = [
    {
      question: "How do I track my delivery?",
      answer: "You can track immediately as the driver accepted your request on a map in realtime and you can go to Notifications on your sidebar driver will send you a delivery message.",
    },
    {
      question: "What areas do you serve?",
      answer: "We serve all areas and cities around the globe.",
    },
    {
      question: "How do I pay?",
      answer: "Payment is made directly to the driver after successful delivery. You can pay using cash or mobile payment methods available in your region.",
    },
    {
      question: "How long does delivery take?",
      answer: "Same city: less than 30 minutes. Between cities: 2-4 hours.",
    },
    {
      question: "Can I cancel an order?",
      answer: "Yes, if the status is 'pending' or 'accepted'. If in transit, please call support.",
    },
    {
      question: "What are your delivery hours?",
      answer: "Services are 24/7,any time any day",
    },
  ];

  const handleContact = (method: 'call' | 'email') => {
    if (method === 'call') {
      Linking.openURL('tel:+263780517601').catch(() => {
        Alert.alert('Error', 'Please dial +263 780517601');
      });
    } else {
      Linking.openURL('mailto:admin@velosdrop.com').catch(() => {
        Alert.alert('Error', 'Please email admin@velosdrop.com');
      });
    }
  };

  return (
    <ScrollView 
      style={styles.container} 
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Help Center</Text>
        <Text style={styles.subtitle}>How can we help you today?</Text>
      </View>

      {/* Primary Actions */}
      <View style={styles.actionRow}>
        <TouchableOpacity 
          style={[styles.actionButton, { backgroundColor: '#10b981' }]} 
          onPress={() => handleContact('call')}
        >
          <Feather name="phone" size={20} color="white" />
          <Text style={styles.actionText}>Call Support</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.actionButton, { backgroundColor: '#3b82f6' }]} 
          onPress={() => handleContact('email')}
        >
          <Feather name="mail" size={20} color="white" />
          <Text style={styles.actionText}>Email Us</Text>
        </TouchableOpacity>
      </View>

      {/* FAQ List */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
        
        {faqs.map((faq, index) => (
          <TouchableOpacity
            key={index}
            onPress={() => setExpandedFAQ(expandedFAQ === index ? null : index)}
            style={styles.faqItem}
            activeOpacity={0.7}
          >
            <View style={styles.faqHeader}>
              <Text style={styles.faqQuestion}>{faq.question}</Text>
              <Feather
                name={expandedFAQ === index ? 'chevron-up' : 'chevron-down'}
                size={20}
                color="#9ca3af"
              />
            </View>
            
            {expandedFAQ === index && (
              <Text style={styles.faqAnswer}>{faq.answer}</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.footer}>VelosDrop • Version 1.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712', // Dark background
  },
  contentContainer: {
    padding: 20,
    paddingTop: 60,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#9ca3af',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 32,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 8,
  },
  actionText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 15,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
    marginBottom: 16,
  },
  faqItem: {
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(75, 85, 99, 0.3)',
  },
  faqHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  faqQuestion: {
    fontSize: 15,
    fontWeight: '500',
    color: 'white',
    flex: 1,
    marginRight: 10,
  },
  faqAnswer: {
    marginTop: 12,
    fontSize: 14,
    color: '#d1d5db',
    lineHeight: 20,
  },
  footer: {
    textAlign: 'center',
    color: '#4b5563',
    fontSize: 12,
    marginTop: 20,
  },
});